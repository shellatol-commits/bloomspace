const API_URL =
  "https://mute-pine-e7d8.lucas-necel.workers.dev";

const STORAGE = {
  accessToken: "bloomspace_access_token",
  refreshToken: "bloomspace_refresh_token",
  theme: "bloomspace_theme"
};

let currentUser = null;

let subjects = [];
let tasks = [];
let notes = [];

let currentNoteId = null;

let taskFilter = "all";

let timer = {
  interval: null,
  running: false,
  duration: 25 * 60,
  remaining: 25 * 60
};

/* =========================================================
   WORKER API
   ========================================================= */

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  const token =
    localStorage.getItem(STORAGE.accessToken);

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(
    `${API_URL}${path}`,
    {
      ...options,
      headers
    }
  );

  const text = await response.text();

  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!response.ok) {
    const message =
      data?.msg ||
      data?.message ||
      data?.error_description ||
      data?.error ||
      `Request failed (${response.status})`;

    throw new Error(message);
  }

  return data;
}

/* =========================================================
   DATABASE COMPATIBILITY LAYER
   ========================================================= */

class QueryBuilder {

  constructor(table) {
    this.table = table;
    this.params = [];
    this.operation = "select";
    this.body = null;
    this.singleMode = false;
    this.maybeSingleMode = false;
  }

  select(columns = "*") {
    this.operation = "select";
    this.params.push(
      `select=${encodeURIComponent(columns)}`
    );

    return this;
  }

  eq(column, value) {
    this.params.push(
      `${encodeURIComponent(column)}=eq.${encodeURIComponent(value)}`
    );

    return this;
  }

  neq(column, value) {
    this.params.push(
      `${encodeURIComponent(column)}=neq.${encodeURIComponent(value)}`
    );

    return this;
  }

  order(column, options = {}) {
    const direction =
      options.ascending === false
        ? "desc"
        : "asc";

    this.params.push(
      `order=${encodeURIComponent(column)}.${direction}`
    );

    return this;
  }

  limit(value) {
    this.params.push(`limit=${value}`);
    return this;
  }

  insert(data) {
    this.operation = "insert";
    this.body = Array.isArray(data)
      ? data
      : [data];

    return this;
  }

  update(data) {
    this.operation = "update";
    this.body = data;

    return this;
  }

  delete() {
    this.operation = "delete";
    return this;
  }

  single() {
    this.singleMode = true;
    this.params.push("limit=1");
    return this;
  }

  maybeSingle() {
    this.maybeSingleMode = true;
    this.params.push("limit=1");
    return this;
  }

  async execute() {

    let method = "GET";

    if (this.operation === "insert") {
      method = "POST";
    }

    if (this.operation === "update") {
      method = "PATCH";
    }

    if (this.operation === "delete") {
      method = "DELETE";
    }

    const query =
      this.params.length
        ? `?${this.params.join("&")}`
        : "";

    const response =
      await api(
        `/db/${encodeURIComponent(this.table)}${query}`,
        {
          method,
          body:
            this.body === null
              ? undefined
              : JSON.stringify(
                  this.body
                ),
          headers: {
            Prefer:
              "return=representation"
          }
        }
      );

    let data = response;

    if (this.singleMode || this.maybeSingleMode) {
      data =
        Array.isArray(response)
          ? response[0] || null
          : response;
    }

    return {
      data,
      error: null
    };
  }

  then(resolve, reject) {
    return this.execute().then(resolve, reject);
  }
}

const db = {
  from(table) {
    return new QueryBuilder(table);
  }
};

/* =========================================================
   AUTH
   ========================================================= */

const auth = {

  async signUp(email, password) {

    const data =
      await api(
        "/auth/register",
        {
          method: "POST",
          body: JSON.stringify({
            email,
            password
          })
        }
      );

    if (data?.access_token) {
      saveSession(data);
    }

    return data;
  },

  async signIn(email, password) {

    const data =
      await api(
        "/auth/login",
        {
          method: "POST",
          body: JSON.stringify({
            email,
            password
          })
        }
      );

    saveSession(data);

    return data;
  },

  async anonymous() {

    const data =
      await api(
        "/auth/anonymous",
        {
          method: "POST"
        }
      );

    saveSession(data);

    return data;
  },

  async getUser() {

    const token =
      localStorage.getItem(
        STORAGE.accessToken
      );

    if (!token) {
      return null;
    }

    try {
      return await api(
        "/auth/user"
      );
    } catch {
      clearSession();
      return null;
    }
  },

  async signOut() {

    try {
      await api(
        "/auth/logout",
        {
          method: "POST"
        }
      );
    } catch {
      // Session cleanup still happens locally.
    }

    clearSession();
  }
};

function saveSession(data) {

  if (data?.access_token) {
    localStorage.setItem(
      STORAGE.accessToken,
      data.access_token
    );
  }

  if (data?.refresh_token) {
    localStorage.setItem(
      STORAGE.refreshToken,
      data.refresh_token
    );
  }
}

function clearSession() {
  localStorage.removeItem(
    STORAGE.accessToken
  );

  localStorage.removeItem(
    STORAGE.refreshToken
  );

  currentUser = null;
}

/* =========================================================
   DOM HELPERS
   ========================================================= */

const $ = selector =>
  document.querySelector(selector);

const $$ = selector =>
  [...document.querySelectorAll(selector)];

function showToast(message) {

  const toast = $("#toast");

  toast.textContent = message;
  toast.classList.remove("hidden");

  clearTimeout(
    showToast.timeout
  );

  showToast.timeout =
    setTimeout(() => {
      toast.classList.add("hidden");
    }, 3000);
}

/* =========================================================
   NAVIGATION
   ========================================================= */

function navigate(page) {

  $$(".page").forEach(section => {
    section.classList.remove("active");
  });

  const target =
    $(`#page-${page}`);

  if (target) {
    target.classList.add("active");
  }

  $$(".nav-item").forEach(item => {
    item.classList.toggle(
      "active",
      item.dataset.page === page
    );
  });

  const titles = {
    home: "Good morning 🌷",
    tasks: "Your tasks",
    subjects: "Your subjects",
    focus: "Focus time",
    notes: "Your notes",
    progress: "Your progress",
    settings: "Settings"
  };

  const subtitles = {
    home: "BloomSpace",
    tasks: "Little wins",
    subjects: "Keep learning",
    focus: "Deep work",
    notes: "Thought garden",
    progress: "Look how far you've come",
    settings: "Make it yours"
  };

  $("#pageTitle").textContent =
    titles[page] || "BloomSpace";

  $("#pageEyebrow").textContent =
    subtitles[page] || "BloomSpace";

  closeMobileSidebar();

  if (page === "home") {
    renderHome();
  }

  if (page === "tasks") {
    renderTasks();
  }

  if (page === "subjects") {
    renderSubjects();
  }

  if (page === "notes") {
    renderNotes();
  }

  if (page === "progress") {
    renderProgress();
  }
}

$$("[data-page]").forEach(button => {

  button.addEventListener(
    "click",
    event => {

      const page =
        event.currentTarget.dataset.page;

      if (page) {
        navigate(page);
      }
    }
  );
});

/* =========================================================
   MOBILE SIDEBAR
   ========================================================= */

function openMobileSidebar() {

  $("#sidebar")
    .classList.add("open");

  $("#mobileOverlay")
    .classList.add("visible");
}

function closeMobileSidebar() {

  $("#sidebar")
    .classList.remove("open");

  $("#mobileOverlay")
    .classList.remove("visible");
}

$("#mobileMenu")
  ?.addEventListener(
    "click",
    openMobileSidebar
  );

$("#mobileOverlay")
  ?.addEventListener(
    "click",
    closeMobileSidebar
);

/* =========================================================
   AUTH UI
   ========================================================= */

let authMode = "login";

function openAuth(mode = "login") {

  authMode = mode;

  $("#authModal")
    .classList.remove("hidden");

  updateAuthUI();
}

function closeAuth() {

  $("#authModal")
    .classList.add("hidden");

  $("#authError").textContent = "";
}

function updateAuthUI() {

  const login =
    authMode === "login";

  $("#authTitle").textContent =
    login
      ? "Come on in 🌷"
      : "Let's grow together 🌱";

  $("#authSubtitle").textContent =
    login
      ? "Sign in to keep your little garden of progress safe."
      : "Create an account and keep BloomSpace with you.";

  $("#authSubmit").textContent =
    login
      ? "Sign in"
      : "Create account";

  $("#authSwitch").textContent =
    login
      ? "Need an account? Sign up"
      : "Already have an account? Sign in";

  $("#authPassword").autocomplete =
    login
      ? "current-password"
      : "new-password";
}

$("#authClose")
  .addEventListener(
    "click",
    closeAuth
  );

$("#authSwitch")
  .addEventListener(
    "click",
    () => {

      authMode =
        authMode === "login"
          ? "signup"
          : "login";

      updateAuthUI();
    }
  );

$("#authForm")
  .addEventListener(
    "submit",
    async event => {

      event.preventDefault();

      const email =
        $("#authEmail").value.trim();

      const password =
        $("#authPassword").value;

      const button =
        $("#authSubmit");

      $("#authError").textContent = "";

      button.disabled = true;

      try {

        const data =
          authMode === "login"
            ? await auth.signIn(
                email,
                password
              )
            : await auth.signUp(
                email,
                password
              );

        if (
          data?.access_token
        ) {

          currentUser =
            await auth.getUser();

          closeAuth();

          await bootUser();

          showToast(
            authMode === "login"
              ? "Welcome back 🌸"
              : "Your BloomSpace is ready 🌱"
          );

        } else {

          $("#authError").textContent =
            "Account created. Check your email if confirmation is required.";
        }

      } catch (error) {

        $("#authError").textContent =
          error.message;

      } finally {

        button.disabled = false;
      }
    }
  );

$("#guestButton")
  .addEventListener(
    "click",
    async () => {

      const button =
        $("#guestButton");

      button.disabled = true;

      try {

        await auth.anonymous();

        currentUser =
          await auth.getUser();

        closeAuth();

        await bootUser();

        showToast(
          "Welcome to your little space 🌱"
        );

      } catch (error) {

        $("#authError").textContent =
          error.message;

      } finally {

        button.disabled = false;
      }
    }
  );

/* =========================================================
   PROFILE
   ========================================================= */

async function loadProfile() {

  if (!currentUser?.id) {
    return;
  }

  try {

    const result =
      await db
        .from("Bloom Hub")
        .select("*")
        .eq(
          "user_id",
          currentUser.id
        )
        .maybeSingle();

    if (result.data) {

      $("#sidebarUsername").textContent =
        result.data.username ||
        currentUser.email?.split("@")[0] ||
        "Guest";

      $("#sidebarAvatar").textContent =
        result.data.avatar_url ||
        "🌸";

      $("#settingsUsername").value =
        result.data.username || "";

      $("#settingsAvatar").value =
        result.data.avatar_url ||
        "🌸";

      applyTheme(
        result.data.theme ||
        localStorage.getItem(
          STORAGE.theme
        ) ||
        "rose"
      );

    } else {

      $("#sidebarUsername").textContent =
        currentUser.email?.split("@")[0] ||
        "Guest";

      $("#sidebarStatus").textContent =
        currentUser.is_anonymous
          ? "Guest account"
          : "Blooming";
    }

  } catch (error) {

    console.warn(
      "Profile load:",
      error.message
    );
  }
}

async function saveProfile() {

  if (!currentUser?.id) {
    return;
  }

  const username =
    $("#settingsUsername")
      .value
      .trim() ||
    "Bloom";

  const avatar =
    $("#settingsAvatar").value;

  const theme =
    document.documentElement
      .dataset.theme ||
    "rose";

  try {

    const existing =
      await db
        .from("Bloom Hub")
        .select("*")
        .eq(
          "user_id",
          currentUser.id
        )
        .maybeSingle();

    if (existing.data) {

      await db
        .from("Bloom Hub")
        .update({
          username,
          avatar_url: avatar,
          theme
        })
        .eq(
          "user_id",
          currentUser.id
        );

    } else {

      await db
        .from("Bloom Hub")
        .insert({
          user_id:
            currentUser.id,
          username,
          avatar_url: avatar,
          theme
        });
    }

    $("#sidebarUsername").textContent =
      username;

    $("#sidebarAvatar").textContent =
      avatar;

    $("#sidebarStatus").textContent =
      currentUser.is_anonymous
        ? "Guest account"
        : "Blooming";

    showToast(
      "Profile saved 🌸"
    );

  } catch (error) {

    showToast(
      `Couldn't save profile: ${error.message}`
    );
  }
}

$("#saveProfileButton")
  .addEventListener(
    "click",
    saveProfile
  );

/* =========================================================
   THEME
   ========================================================= */

function applyTheme(theme) {

  document.documentElement
    .dataset.theme = theme;

  localStorage.setItem(
    STORAGE.theme,
    theme
  );

  $$(".theme-option").forEach(
    button => {
      button.classList.toggle(
        "active",
        button.dataset.theme === theme
      );
    }
  );
}

$$(".theme-option")
  .forEach(button => {

    button.addEventListener(
      "click",
      async () => {

        applyTheme(
          button.dataset.theme
        );

        if (currentUser) {
          await saveProfile();
        }
      }
    );
  });

/* =========================================================
   SUBJECTS
   ========================================================= */

async function loadSubjects() {

  if (!currentUser?.id) {
    subjects = [];
    return;
  }

  try {

    const result =
      await db
        .from("Bloom Subjects")
        .select("*")
        .eq(
          "user_id",
          currentUser.id
        )
        .order(
          "created_at",
          {
            ascending: true
          }
        );

    subjects =
      result.data || [];

  } catch (error) {

    console.warn(
      "Subjects:",
      error.message
    );

    subjects = [];
  }
}

function renderSubjects() {

  const grid =
    $("#subjectGrid");

  if (!subjects.length) {

    grid.innerHTML = `
      <div class="panel empty-state">
        <div>🌱</div>
        <p>No subjects yet.</p>
        <span>Create your first learning space.</span>
      </div>
    `;

    return;
  }

  grid.innerHTML =
    subjects
      .map(subject => {

        const count =
          tasks.filter(
            task =>
              String(task.subject_id) ===
              String(subject.id)
          ).length;

        return `
          <div class="subject-card">

            <button
              class="subject-delete"
              data-delete-subject="${subject.id}"
              title="Delete subject"
            >
              ×
            </button>

            <div class="subject-icon">
              ${escapeHTML(subject.icon || "📚")}
            </div>

            <h3>
              ${escapeHTML(subject.name)}
            </h3>

            <p>
              ${count}
              ${count === 1 ? "task" : "tasks"}
            </p>

          </div>
        `;
      })
      .join("");

  $$("[data-delete-subject]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () =>
          deleteSubject(
            button.dataset.deleteSubject
          )
      );
    });
}

async function createSubject() {

  const name =
    $("#subjectName")
      .value
      .trim();

  const icon =
    $("#subjectIcon").value;

  if (!name) {
    return;
  }

  try {

    await db
      .from("Bloom Subjects")
      .insert({
        user_id:
          currentUser.id,
        name,
        icon
      });

    $("#subjectForm").reset();

    closeModal(
      "subjectModal"
    );

    await loadSubjects();

    renderSubjects();

    updateSubjectSelect();

    showToast(
      "New subject planted 🌱"
    );

  } catch (error) {

    showToast(
      `Couldn't create subject: ${error.message}`
    );
  }
}

async function deleteSubject(id) {

  if (
    !confirm(
      "Delete this subject?"
    )
  ) {
    return;
  }

  try {

    await db
      .from("Bloom Subjects")
      .delete()
      .eq(
        "id",
        id
      );

    await loadSubjects();
    await loadTasks();

    renderSubjects();

    updateSubjectSelect();

    showToast(
      "Subject removed."
    );

  } catch (error) {

    showToast(
      `Couldn't delete subject: ${error.message}`
    );
  }
}

$("#addSubjectButton")
  .addEventListener(
    "click",
    () =>
      openModal(
        "subjectModal"
      )
  );

$("#subjectModalClose")
  .addEventListener(
    "click",
    () =>
      closeModal(
        "subjectModal"
      )
  );

$("#subjectForm")
  .addEventListener(
    "submit",
    event => {

      event.preventDefault();

      createSubject();
    }
  );

/* =========================================================
   TASKS
   ========================================================= */

async function loadTasks() {

  if (!currentUser?.id) {
    tasks = [];
    return;
  }

  try {

    const result =
      await db
        .from("Bloom Tasks")
        .select("*")
        .eq(
          "user_id",
          currentUser.id
        )
        .order(
          "created_at",
          {
            ascending: false
          }
        );

    tasks =
      result.data || [];

  } catch (error) {

    console.warn(
      "Tasks:",
      error.message
    );

    tasks = [];
  }
}

function filteredTasks() {

  if (taskFilter === "active") {
    return tasks.filter(
      task => !task.completed
    );
  }

  if (taskFilter === "completed") {
    return tasks.filter(
      task => task.completed
    );
  }

  return tasks;
}

function renderTasks() {

  const list =
    $("#taskList");

  const visible =
    filteredTasks();

  if (!visible.length) {

    list.innerHTML = `
      <div class="empty-state">
        <div>🌷</div>
        <p>Nothing here yet.</p>
        <span>Enjoy the breathing room or add a new task.</span>
      </div>
    `;

  } else {

    list.innerHTML =
      visible
        .map(task => {

          const subject =
            subjects.find(
              subject =>
                String(subject.id) ===
                String(task.subject_id)
            );

          return `
            <div
              class="full-task ${
                task.completed
                  ? "completed"
                  : ""
              }"
            >

              <button
                class="task-check"
                data-toggle-task="${task.id}"
              >
                ${
                  task.completed
                    ? "✓"
                    : ""
                }
              </button>

              <div class="full-task-content">

                <strong>
                  ${escapeHTML(task.title)}
                </strong>

                <span>
                  ${
                    subject
                      ? `${escapeHTML(subject.icon || "📚")} ${escapeHTML(subject.name)}`
                      : task.due_date
                        ? `Due ${formatDate(task.due_date)}`
                        : "Personal task"
                  }
                </span>

              </div>

              <button
                class="task-delete"
                data-delete-task="${task.id}"
              >
                ×
              </button>

            </div>
          `;
        })
        .join("");

    $$("[data-toggle-task]")
      .forEach(button => {

        button.addEventListener(
          "click",
          () =>
            toggleTask(
              button.dataset.toggleTask
            )
        );
      });

    $$("[data-delete-task]")
      .forEach(button => {

        button.addEventListener(
          "click",
          () =>
            deleteTask(
              button.dataset.deleteTask
            )
        );
      });
  }

  updateTaskSummary();
}

async function createTask() {

  const title =
    $("#taskTitle")
      .value
      .trim();

  const subjectId =
    $("#taskSubject").value;

  const dueDate =
    $("#taskDueDate").value ||
    null;

  if (!title) {
    return;
  }

  try {

    await db
      .from("Bloom Tasks")
      .insert({
        user_id:
          currentUser.id,

        title,

        subject_id:
          subjectId
            ? Number(subjectId)
            : null,

        completed: false,

        due_date:
          dueDate
      });

    $("#taskForm").reset();

    closeModal(
      "taskModal"
    );

    await loadTasks();

    renderTasks();
    renderHome();

    showToast(
      "Task added 🌱"
    );

  } catch (error) {

    showToast(
      `Couldn't add task: ${error.message}`
    );
  }
}

async function toggleTask(id) {

  const task =
    tasks.find(
      item =>
        String(item.id) ===
        String(id)
    );

  if (!task) {
    return;
  }

  const newCompleted =
    !task.completed;

  try {

    await db
      .from("Bloom Tasks")
      .update({
        completed:
          newCompleted
      })
      .eq(
        "id",
        id
      );

    if (newCompleted) {

      await addXP(10);

      showToast(
        "+10 XP — tiny win! ✨"
      );
    }

    await loadTasks();

    renderTasks();
    renderHome();
    renderProgress();

  } catch (error) {

    showToast(
      `Couldn't update task: ${error.message}`
    );
  }
}

async function deleteTask(id) {

  try {

    await db
      .from("Bloom Tasks")
      .delete()
      .eq(
        "id",
        id
      );

    await loadTasks();

    renderTasks();
    renderHome();

    showToast(
      "Task removed."
    );

  } catch (error) {

    showToast(
      `Couldn't delete task: ${error.message}`
    );
  }
}

function updateTaskSummary() {

  const total =
    tasks.length;

  const completed =
    tasks.filter(
      task => task.completed
    ).length;

  $("#taskSummaryNumber")
    .textContent = total;

  const percent =
    total
      ? Math.round(
          (completed / total) * 100
        )
      : 0;

  $("#taskMiniProgress")
    .style.width =
    `${percent}%`;

  $("#taskMiniProgressText")
    .textContent =
    `${percent}% complete`;
}

function updateSubjectSelect() {

  const select =
    $("#taskSubject");

  select.innerHTML = `
    <option value="">
      No subject
    </option>
  `;

  subjects.forEach(subject => {

    const option =
      document.createElement(
        "option"
      );

    option.value =
      subject.id;

    option.textContent =
      `${subject.icon || "📚"} ${subject.name}`;

    select.appendChild(
      option
    );
  });
}

$("#addTaskButton")
  .addEventListener(
    "click",
    () =>
      openModal(
        "taskModal"
      )
  );

$("#quickAddButton")
  .addEventListener(
    "click",
    () =>
      openModal(
        "taskModal"
      )
  );

$("#taskModalClose")
  .addEventListener(
    "click",
    () =>
      closeModal(
        "taskModal"
      )
  );

$("#taskForm")
  .addEventListener(
    "submit",
    event => {

      event.preventDefault();

      createTask();
    }
  );

$$("[data-task-filter]")
  .forEach(button => {

    button.addEventListener(
      "click",
      () => {

        taskFilter =
          button.dataset.taskFilter;

        $$("[data-task-filter]")
          .forEach(item => {

            item.classList.toggle(
              "active",
              item === button
            );
          });

        renderTasks();
      }
    );
  });

/* =========================================================
   HOME
   ========================================================= */

function renderHome() {

  const completed =
    tasks.filter(
      task => task.completed
    ).length;

  $("#homeTasksDone")
    .textContent =
    completed;

  $("#homeFocusMinutes")
    .textContent =
    progress.focus_minutes || 0;

  $("#homeStreak")
    .textContent =
    `${progress.streak || 0} days`;

  $("#homeXP")
    .textContent =
    progress.xp || 0;

  $("#topStreak")
    .textContent =
    progress.streak || 0;

  const total =
    tasks.length;

  const percent =
    total
      ? Math.round(
          (completed / total) * 100
        )
      : 0;

  $("#homeProgressPercent")
    .textContent =
    `${percent}%`;

  $("#homeProgressRing")
    .style.setProperty(
      "--progress",
      `${percent}%`
    );

  const homeList =
    $("#homeTaskList");

  const active =
    tasks
      .filter(
        task =>
          !task.completed
      )
      .slice(0, 5);

  if (!active.length) {

    homeList.innerHTML = `
      <div class="empty-state">
        <div>🌱</div>
        <p>No active tasks.</p>
        <span>Your garden is nice and quiet.</span>
      </div>
    `;

    return;
  }

  homeList.innerHTML =
    active
      .map(task => {

        const subject =
          subjects.find(
            item =>
              String(item.id) ===
              String(task.subject_id)
          );

        return `
          <div class="task-row">

            <button
              class="task-check"
              data-home-toggle="${task.id}"
            ></button>

            <span class="task-name">
              ${escapeHTML(task.title)}
            </span>

            ${
              subject
                ? `
                  <span class="task-subject">
                    ${escapeHTML(subject.name)}
                  </span>
                `
                : ""
            }

          </div>
        `;
      })
      .join("");

  $$("[data-home-toggle]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () =>
          toggleTask(
            button.dataset.homeToggle
          )
      );
    });
}

/* =========================================================
   NOTES
   ========================================================= */

async function loadNotes() {

  if (!currentUser?.id) {
    notes = [];
    return;
  }

  try {

    const result =
      await db
        .from("Bloom Notes")
        .select("*")
        .eq(
          "user_id",
          currentUser.id
        )
        .order(
          "updated_at",
          {
            ascending: false
          }
        );

    notes =
      result.data || [];

  } catch (error) {

    console.warn(
      "Notes:",
      error.message
    );

    notes = [];
  }
}

function renderNotes() {

  const list =
    $("#notesList");

  if (!notes.length) {

    list.innerHTML = `
      <div class="empty-state">
        <div>🌷</div>
        <p>No notes yet.</p>
        <span>Start a little thought garden.</span>
      </div>
    `;

    return;
  }

  list.innerHTML =
    notes
      .map(note => {

        return `
          <button
            class="note-item ${
              String(note.id) ===
              String(currentNoteId)
                ? "active"
                : ""
            }"
            data-note-id="${note.id}"
          >
            <strong>
              ${escapeHTML(
                note.title ||
                "Untitled note"
              )}
            </strong>

            <span>
              ${escapeHTML(
                note.content ||
                "Empty note"
              )}
            </span>
          </button>
        `;
      })
      .join("");

  $$("[data-note-id]")
    .forEach(button => {

      button.addEventListener(
        "click",
        () =>
          selectNote(
            button.dataset.noteId
          )
      );
    });
}

function selectNote(id) {

  const note =
    notes.find(
      item =>
        String(item.id) ===
        String(id)
    );

  if (!note) {
    return;
  }

  currentNoteId =
    note.id;

  $("#noteTitle").value =
    note.title || "";

  $("#noteContent").value =
    note.content || "";

  $("#noteSaveStatus")
    .textContent =
    "Saved";

  renderNotes();
}

function newNote() {

  currentNoteId = null;

  $("#noteTitle").value =
    "";

  $("#noteContent").value =
    "";

  $("#noteSaveStatus")
    .textContent =
    "New note";

  renderNotes();

  $("#noteTitle").focus();
}

async function saveNote() {

  if (!currentUser?.id) {
    return;
  }

  const title =
    $("#noteTitle")
      .value
      .trim() ||
    "Untitled note";

  const content =
    $("#noteContent").value;

  try {

    if (currentNoteId) {

      await db
        .from("Bloom Notes")
        .update({
          title,
          content,
          updated_at:
            new Date().toISOString()
        })
        .eq(
          "id",
          currentNoteId
        );

    } else {

      const result =
        await db
          .from("Bloom Notes")
          .insert({
            user_id:
              currentUser.id,

            title,
            content,

            updated_at:
              new Date().toISOString()
          });

      currentNoteId =
        result.data?.[0]?.id ||
        null;
    }

    await loadNotes();

    renderNotes();

    $("#noteSaveStatus")
      .textContent =
      "Saved just now";

    showToast(
      "Note saved 🌸"
    );

  } catch (error) {

    showToast(
      `Couldn't save note: ${error.message}`
    );
  }
}

$("#newNoteButton")
  .addEventListener(
    "click",
    newNote
  );

$("#saveNoteButton")
  .addEventListener(
    "click",
    saveNote
  );

/* =========================================================
   FOCUS TIMER
   ========================================================= */

function setTimerMinutes(minutes) {

  if (timer.running) {
    return;
  }

  timer.duration =
    minutes * 60;

  timer.remaining =
    timer.duration;

  updateTimerDisplay();

  $$(".timer-preset")
    .forEach(button => {

      button.classList.toggle(
        "active",
        Number(
          button.dataset.minutes
        ) === minutes
      );
    });
}

$$(".timer-preset")
  .forEach(button => {

    button.addEventListener(
      "click",
      () =>
        setTimerMinutes(
          Number(
            button.dataset.minutes
          )
        )
    );
  });

function updateTimerDisplay() {

  const minutes =
    Math.floor(
      timer.remaining / 60
    );

  const seconds =
    timer.remaining % 60;

  $("#timerDisplay")
    .textContent =
    `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

  const elapsed =
    timer.duration -
    timer.remaining;

  const percent =
    timer.duration
      ? Math.round(
          (elapsed /
            timer.duration) *
            100
        )
      : 0;

  $(".timer-circle")
    .style.setProperty(
      "--timer-progress",
      `${percent}%`
    );
}

function startTimer() {

  if (timer.running) {

    pauseTimer();

    return;
  }

  timer.running = true;

  $("#timerStart")
    .textContent =
    "Pause";

  $("#timerStatus")
    .textContent =
    "You're doing great. Keep going.";

  timer.interval =
    setInterval(
      async () => {

        timer.remaining--;

        updateTimerDisplay();

        if (
          timer.remaining <= 0
        ) {

          clearInterval(
            timer.interval
          );

          timer.interval = null;
          timer.running = false;

          $("#timerStart")
            .textContent =
            "Start focus";

          $("#timerStatus")
            .textContent =
            "Session complete ✨";

          const minutes =
            Math.round(
              timer.duration / 60
            );

          await recordFocusSession(
            minutes
          );

          showToast(
            `${minutes} minutes focused. Beautiful work 🌸`
          );
        }

      },
      1000
    );
}

function pauseTimer() {

  clearInterval(
    timer.interval
  );

  timer.interval = null;
  timer.running = false;

  $("#timerStart")
    .textContent =
    "Resume";

  $("#timerStatus")
    .textContent =
    "Paused";
}

function resetTimer() {

  clearInterval(
    timer.interval
  );

  timer.interval = null;
  timer.running = false;

  timer.remaining =
    timer.duration;

  $("#timerStart")
    .textContent =
    "Start focus";

  $("#timerStatus")
    .textContent =
    "Ready when you are";

  updateTimerDisplay();
}

$("#timerStart")
  .addEventListener(
    "click",
    startTimer
  );

$("#timerReset")
  .addEventListener(
    "click",
    resetTimer
  );

async function recordFocusSession(minutes) {

  try {

    await db
      .from("Bloom Focus Sessions")
      .insert({
        user_id:
          currentUser.id,
        minutes
      });

    await addXP(
      minutes
    );

    progress.focus_minutes =
      Number(
        progress.focus_minutes || 0
      ) + minutes;

    renderHome();
    renderProgress();

  } catch (error) {

    console.warn(
      "Focus session:",
      error.message
    );
  }
}

/* =========================================================
   PROGRESS
   ========================================================= */

let progress = {
  xp: 0,
  streak: 0,
  tasks_completed: 0,
  focus_minutes: 0
};

async function loadProgress() {

  if (!currentUser?.id) {
    return;
  }

  try {

    const result =
      await db
        .from("Bloom Progress")
        .select("*")
        .eq(
          "user_id",
          currentUser.id
        )
        .maybeSingle();

    if (result.data) {

      progress = {
        ...progress,
        ...result.data
      };

    } else {

      await db
        .from("Bloom Progress")
        .insert({
          user_id:
            currentUser.id,
          xp: 0,
          streak: 0,
          tasks_completed: 0,
          focus_minutes: 0
        });
    }

  } catch (error) {

    console.warn(
      "Progress:",
      error.message
    );
  }
}

async function addXP(amount) {

  if (!currentUser?.id) {
    return;
  }

  progress.xp =
    Number(progress.xp || 0) +
    Number(amount);

  try {

    await db
      .from("Bloom Progress")
      .update({
        xp: progress.xp
      })
      .eq(
        "user_id",
        currentUser.id
      );

  } catch (error) {

    console.warn(
      "XP:",
      error.message
    );
  }
}

function getLevel(xp) {

  return Math.max(
    1,
    Math.floor(
      Number(xp || 0) / 100
    ) + 1
  );
}

function getLevelTitle(level) {

  if (level >= 10) {
    return "Garden Keeper";
  }

  if (level >= 7) {
    return "Wildflower";
  }

  if (level >= 5) {
    return "Blooming";
  }

  if (level >= 3) {
    return "Growing";
  }

  return "Seedling";
}

function renderProgress() {

  const xp =
    Number(progress.xp || 0);

  const level =
    getLevel(xp);

  const currentLevelXP =
    (level - 1) * 100;

  const nextLevelXP =
    level * 100;

  const progressXP =
    Math.min(
      100,
      Math.max(
        0,
        ((xp - currentLevelXP) /
          100) *
          100
      )
    );

  $("#levelNumber")
    .textContent =
    level;

  $("#levelTitle")
    .textContent =
    getLevelTitle(level);

  $("#currentXP")
    .textContent =
    `${xp} XP`;

  $("#nextLevelXP")
    .textContent =
    `${nextLevelXP} XP`;

  $("#xpBar")
    .style.width =
    `${progressXP}%`;

  const completed =
    tasks.filter(
      task =>
        task.completed
    ).length;

  $("#progressStreak")
    .textContent =
    progress.streak || 0;

  $("#progressTasks")
    .textContent =
    completed;

  $("#progressFocus")
    .textContent =
    progress.focus_minutes || 0;

  $("#focusTotalMinutes")
    .textContent =
    progress.focus_minutes || 0;
}

/* =========================================================
   MODALS
   ========================================================= */

function openModal(id) {

  $(`#${id}`)
    .classList.remove("hidden");
}

function closeModal(id) {

  $(`#${id}`)
    .classList.add("hidden");
}

document
  .querySelectorAll(".modal-backdrop")
  .forEach(backdrop => {

    backdrop.addEventListener(
      "click",
      event => {

        if (
          event.target ===
          backdrop
        ) {
          backdrop.classList.add(
            "hidden"
          );
        }
      }
    );
  });

/* =========================================================
   LOGOUT
   ========================================================= */

$("#logoutButton")
  .addEventListener(
    "click",
    async () => {

      await auth.signOut();

      subjects = [];
      tasks = [];
      notes = [];

      navigate("home");

      updateAuthState();

      showToast(
        "See you next time 🌷"
      );
    }
  );

function updateAuthState() {

  if (!currentUser) {

    $("#sidebarUsername")
      .textContent =
      "Guest";

    $("#sidebarStatus")
      .textContent =
      "Not signed in";

    $("#sidebarAvatar")
      .textContent =
      "🌸";

    return;
  }

  $("#sidebarStatus")
    .textContent =
    currentUser.is_anonymous
      ? "Guest account"
      : "Blooming";
}

/* =========================================================
   BOOT
   ========================================================= */

async function bootUser() {

  updateAuthState();

  await loadProfile();

  await loadSubjects();

  await loadTasks();

  await loadNotes();

  await loadProgress();

  updateSubjectSelect();

  renderSubjects();

  renderTasks();

  renderNotes();

  renderProgress();

  renderHome();

  updateTimerDisplay();
}

async function initialize() {

  const savedTheme =
    localStorage.getItem(
      STORAGE.theme
    );

  applyTheme(
    savedTheme || "rose"
  );

  currentUser =
    await auth.getUser();

  if (!currentUser) {

    updateAuthState();

    /*
     * BloomSpace starts with a usable guest
     * entry point rather than forcing login.
     */
    openAuth("login");

    return;
  }

  await bootUser();
}

/* =========================================================
   UTILITIES
   ========================================================= */

function escapeHTML(value) {

  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(dateString) {

  if (!dateString) {
    return "";
  }

  const date =
    new Date(
      `${dateString}T00:00:00`
    );

  return date.toLocaleDateString(
    undefined,
    {
      month: "short",
      day: "numeric"
    }
  );
}

/* =========================================================
   START
   ========================================================= */

initialize();
