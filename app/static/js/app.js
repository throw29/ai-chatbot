/* ==========================================================================
   Aurora AI girlfriend — front-end logic
   Vanilla JS + Axios + marked + DOMPurify. State lives in localStorage.
   ========================================================================== */

(() => {
  "use strict";

  const STORAGE_KEYS = {
    sessions: "aurora.sessions.v1",
    activeSession: "aurora.active-session.v1",
    theme: "aurora.theme.v1",
    persona: "aurora.persona.v1",
  };

  const LIMITS = {
    maxContextMessages: 30,
    maxContextCharacters: 90_000,
    maxMessageCharacters: 20_000,
    maxSessions: 40,
    inputCharacters: 12_000,
    personaNameCharacters: 16,
  };

  const PERSONAS = [
    {
      id: "gentle",
      label: "温柔",
      tagline: "把你的情绪，轻轻接住",
      quote: "“今天辛苦了，过来让我抱抱。”",
      icon: "i-heart",
      tone: "#ffabc2",
      tone2: "#ffd0df",
      toneRgb: "255, 171, 194",
      greeting:
        "你回来啦，我是{name}。{time}。今天也辛苦了……先让我抱抱你，再慢慢听你说，好不好？",
    },
    {
      id: "tsundere",
      label: "傲娇",
      tagline: "嘴上嫌弃，心里全是你",
      quote: "“才、才没有特意等你呢。”",
      icon: "i-sparkles",
      tone: "#ff91a7",
      tone2: "#ffc2b8",
      toneRgb: "255, 145, 167",
      greeting:
        "哼，你终于来了。我是{name}，才、才没有一直等你呢。{time}……今天过得怎么样？快说给我听。",
    },
    {
      id: "sharp",
      label: "犀利",
      tagline: "看穿你，也永远站你这边",
      quote: "“别用‘没事’敷衍我，说真话。”",
      icon: "i-bolt",
      tone: "#9cd9ef",
      tone2: "#b7c5ff",
      toneRgb: "156, 217, 239",
      greeting:
        "来了？我是{name}。{time}。不用急着说漂亮话，坐过来，告诉我今天最真实的一件事。",
    },
    {
      id: "grumpy",
      label: "暴躁",
      tagline: "火气很大，偏心更明显",
      quote: "“谁惹你了？我现在就去……算了，先抱一下。”",
      icon: "i-flame",
      tone: "#ffad7d",
      tone2: "#ff8e7a",
      toneRgb: "255, 173, 125",
      greeting:
        "你怎么现在才来啊！……算了，看在你来了的份上，今天先不跟你计较。我是{name}，{time}，说吧，谁惹你了？",
    },
    {
      id: "sunny",
      label: "元气",
      tagline: "把普通的一天变成小冒险",
      quote: "“走呀！今天也要一起去发现好事情。”",
      icon: "i-sun",
      tone: "#ffd888",
      tone2: "#ffb777",
      toneRgb: "255, 216, 136",
      greeting:
        "抓住你啦！我是{name}！{time}——今天也要和我一起，把普通的一天过成小小冒险。先从最开心的一件事说起吧！",
    },
    {
      id: "cool",
      label: "高冷",
      tagline: "话不多，但温柔都藏在细节里",
      quote: "“……过来。没说不让你靠着我。”",
      icon: "i-moon",
      tone: "#b7a7ff",
      tone2: "#8bc8ff",
      toneRgb: "183, 167, 255",
      greeting:
        "……来了。我是{name}。{time}。不用刻意找话题，想说什么就说，我在这儿。",
    },
  ];

  const PERSONA_MAP = Object.fromEntries(PERSONAS.map((persona) => [persona.id, persona]));
  const DEFAULT_PERSONA = PERSONAS[0];

  const IS_MAC = /Mac|iPhone|iPad|iPod/i.test(
    navigator.platform || navigator.userAgent || ""
  );
  const SHORTCUT_LABEL = IS_MAC ? "⌘ K" : "Ctrl K";
  const MOBILE_SIDEBAR = window.matchMedia("(max-width: 920px)");
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");

  const api = window.axios
    ? window.axios.create({
        baseURL: "",
        timeout: 610_000, // Backend total deadline is configurable up to 600 s.
        headers: { Accept: "application/json" },
      })
    : null;

  const state = {
    persona: null,
    sessions: [],
    activeSessionId: null,
    isLoading: false,
    activeRequest: null,
    requestSequence: 0,
    health: null,
    sidebarOpen: false,
    storageWarned: false,
    fatal: !api,
    setupMode: "create",
    setupDraft: { personality: null, name: "" },
  };

  const els = {};
  let messageInputComposing = false;
  let nameInputComposing = false;

  const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  /* ------------------------------------------------------------------------
     Boot
     ------------------------------------------------------------------------ */

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }

  function init() {
    cacheElements();
    bindEvents();
    syncThemeUI();
    syncShortcutLabel();
    syncSidebarInert();

    state.persona = loadPersona();
    loadSessions(); // Preserve legacy history until the user approves a reset.

    if (state.persona) {
      applyPersona(state.persona);
      document.documentElement.dataset.view = "chat";
      ensureChatSession();
      persistSessions();
      refreshUI({ forceScroll: true, scrollMode: "auto" });
    } else {
      document.documentElement.dataset.view = "setup";
      openSetup("create", { initial: true });
    }

    updateSendButton();
    checkHealth();

    if (state.fatal) {
      showToast("前端依赖加载失败，请刷新页面后重试。", "error", 7000);
    } else if (
      state.persona &&
      window.matchMedia("(pointer: fine)").matches
    ) {
      requestAnimationFrame(() => els.messageInput.focus());
    }
  }

  function cacheElements() {
    const byId = (id) => document.getElementById(id);

    els.main = document.querySelector(".main");
    els.sidebar = byId("sidebar");
    els.sidebarBackdrop = byId("sidebarBackdrop");
    els.openSidebarBtn = byId("openSidebarBtn");
    els.sidebarCloseBtn = byId("sidebarCloseBtn");
    els.newChatBtn = byId("newChatBtn");
    els.newChatTopBtn = byId("newChatTopBtn");
    els.newChatShortcut = byId("newChatShortcut");
    els.historyList = byId("historyList");
    els.historyEmpty = byId("historyEmpty");
    els.historyCount = byId("historyCount");
    els.statusDot = byId("statusDot");
    els.statusText = byId("statusText");
    els.statusModel = byId("statusModel");
    els.connectionCard = byId("connectionCard");
    els.themeToggle = byId("themeToggle");
    els.themeLabel = byId("themeLabel");
    els.clearAllBtn = byId("clearAllBtn");
    els.conversationTitle = byId("conversationTitle");
    els.topbarStatus = byId("topbarStatus");
    els.topbarAvatarInitial = byId("topbarAvatarInitial");
    els.personaSettingsBtn = byId("personaSettingsBtn");
    els.chatStage = byId("chatStage");
    els.messages = byId("messages");
    els.composer = byId("composer");
    els.messageInput = byId("messageInput");
    els.sendButton = byId("sendButton");
    els.characterCount = byId("characterCount");
    els.scrollToBottom = byId("scrollToBottom");
    els.toastRegion = byId("toastRegion");
    els.themeMeta = document.querySelector('meta[name="theme-color"]');

    els.setupScreen = byId("setupScreen");
    els.setupCloseBtn = byId("setupCloseBtn");
    els.setupStep1 = byId("setupStep1");
    els.setupStep2 = byId("setupStep2");
    els.setupProgressSteps = Array.from(
      document.querySelectorAll("[data-setup-progress]")
    );
    els.personaGrid = byId("personaGrid");
    els.personaSelectionHint = byId("personaSelectionHint");
    els.setupNextBtn = byId("setupNextBtn");
    els.setupBackBtn = byId("setupBackBtn");
    els.personaNameInput = byId("personaNameInput");
    els.nameCounter = byId("nameCounter");
    els.nameAvatarInitial = byId("nameAvatarInitial");
    els.nameField = byId("nameField");
    els.personaSummary = byId("personaSummary");
    els.setupFinishBtn = byId("setupFinishBtn");
    els.nameSuggestions = byId("nameSuggestions");
  }

  function bindEvents() {
    els.composer.addEventListener("submit", handleComposerSubmit);
    els.messageInput.addEventListener("input", handleInput);
    els.messageInput.addEventListener("compositionstart", () => {
      messageInputComposing = true;
    });
    els.messageInput.addEventListener("compositionend", () => {
      messageInputComposing = false;
    });
    els.messageInput.addEventListener("keydown", handleInputKeydown);

    els.newChatBtn.addEventListener("click", startNewChat);
    els.newChatTopBtn.addEventListener("click", startNewChat);
    els.themeToggle.addEventListener("click", toggleTheme);
    els.clearAllBtn.addEventListener("click", clearAllSessions);
    els.personaSettingsBtn.addEventListener("click", () => openSetup("edit"));

    els.openSidebarBtn.addEventListener("click", openSidebar);
    els.sidebarCloseBtn.addEventListener("click", () => closeSidebar());
    els.sidebarBackdrop.addEventListener("click", () => closeSidebar());

    els.scrollToBottom.addEventListener("click", () => scrollToBottom("smooth"));
    els.chatStage.addEventListener("scroll", updateScrollButton, { passive: true });

    els.setupNextBtn.addEventListener("click", goToNameStep);
    els.setupBackBtn.addEventListener("click", goToPersonaStep);
    els.setupCloseBtn.addEventListener("click", closeSetup);
    els.setupFinishBtn.addEventListener("click", finishSetup);

    els.personaNameInput.addEventListener("input", updateNameUi);
    els.personaNameInput.addEventListener("compositionstart", () => {
      nameInputComposing = true;
    });
    els.personaNameInput.addEventListener("compositionend", () => {
      nameInputComposing = false;
      updateNameUi();
    });
    els.personaNameInput.addEventListener("keydown", (event) => {
      if (
        event.key === "Enter" &&
        !event.isComposing &&
        !nameInputComposing &&
        !els.setupFinishBtn.disabled
      ) {
        event.preventDefault();
        finishSetup();
      }
    });

    els.nameSuggestions.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-name]");
      if (!button) return;
      els.personaNameInput.value = button.dataset.name || "";
      updateNameUi();
      els.personaNameInput.focus();
    });

    document.addEventListener("keydown", handleGlobalKeydown);
    MOBILE_SIDEBAR.addEventListener("change", (event) => {
      if (!event.matches) closeSidebar();
      syncSidebarInert();
    });
    window.addEventListener("resize", updateScrollButton, { passive: true });
  }

  /* ------------------------------------------------------------------------
     Setup flow
     ------------------------------------------------------------------------ */

  function openSetup(mode = "create", { initial = false } = {}) {
    const nextMode = mode === "edit" && state.persona ? "edit" : "create";

    if (state.isLoading) cancelActiveRequest();
    closeSidebar();

    state.setupMode = nextMode;
    state.setupDraft.personality =
      nextMode === "edit" && state.persona ? state.persona.personality : null;
    state.setupDraft.name =
      nextMode === "edit" && state.persona ? state.persona.name : "";

    buildPersonaGrid();
    els.personaNameInput.value = state.setupDraft.name;
    els.setupCloseBtn.hidden = nextMode !== "edit";
    setSetupFinishLabel();

    if (state.setupDraft.personality) {
      setPersonaTone(state.setupDraft.personality);
    } else {
      setPersonaTone(DEFAULT_PERSONA.id);
    }

    updateNameUi();
    updatePersonalitySelectionUi();
    showSetupStep(1, { focus: false });

    document.documentElement.dataset.view = "setup";
    document.title = "Aurora · 遇见你的 AI 女友";
    if (els.setupScreen) els.setupScreen.scrollTop = 0;

    if (!initial) {
      requestAnimationFrame(() => {
        const target =
          els.personaGrid.querySelector(".persona-card.is-selected") ||
          els.personaGrid.querySelector(".persona-card");
        target?.focus({ preventScroll: true });
      });
    }
  }

  function buildPersonaGrid() {
    els.personaGrid.replaceChildren();

    PERSONAS.forEach((persona) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "persona-card";
      button.dataset.personality = persona.id;
      button.style.setProperty("--tone", persona.tone);
      button.style.setProperty("--tone-rgb", persona.toneRgb);
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("title", `${persona.label} · ${persona.tagline}`);

      button.innerHTML = `
        <span class="persona-card__top">
          <span class="persona-card__icon">
            <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#${persona.icon}"></use></svg>
          </span>
          <span class="persona-card__check" aria-hidden="true">
            <svg viewBox="0 0 24 24"><use href="#i-check"></use></svg>
          </span>
        </span>
        <span class="persona-card__name"></span>
        <span class="persona-card__tagline"></span>
        <span class="persona-card__quote"></span>
      `;

      button.querySelector(".persona-card__name").textContent = persona.label;
      button.querySelector(".persona-card__tagline").textContent = persona.tagline;
      button.querySelector(".persona-card__quote").textContent = persona.quote;
      button.addEventListener("click", () => selectSetupPersonality(persona.id));
      els.personaGrid.appendChild(button);
    });
  }

  function selectSetupPersonality(personalityId) {
    if (!PERSONA_MAP[personalityId]) return;
    state.setupDraft.personality = personalityId;
    setPersonaTone(personalityId);
    updateNameUi();
    updatePersonalitySelectionUi();
  }

  function updatePersonalitySelectionUi() {
    const selectedId = state.setupDraft.personality;

    els.personaGrid.querySelectorAll(".persona-card").forEach((card) => {
      const selected = card.dataset.personality === selectedId;
      card.classList.toggle("is-selected", selected);
      card.setAttribute("aria-pressed", selected ? "true" : "false");
    });

    const selectedPersona = PERSONA_MAP[selectedId] || null;
    els.setupNextBtn.disabled = !selectedPersona;
    els.personaSelectionHint.textContent = selectedPersona
      ? `已选择：${selectedPersona.label} · ${selectedPersona.tagline}`
      : "选择一种性格继续";

    updatePersonaSummary(selectedPersona);
  }

  function updatePersonaSummary(selectedPersona = PERSONA_MAP[state.setupDraft.personality]) {
    if (!selectedPersona) {
      els.personaSummary.hidden = true;
      els.personaSummary.replaceChildren();
      return;
    }

    const name = normalizePersonaName(els.personaNameInput.value);
    els.personaSummary.hidden = false;
    els.personaSummary.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true"><use href="#${selectedPersona.icon}"></use></svg>
      <span></span>
    `;
    els.personaSummary.querySelector("span").textContent = name
      ? `${name} · ${selectedPersona.label}女友`
      : `${selectedPersona.label}女友 · ${selectedPersona.tagline}`;
  }

  function goToNameStep() {
    if (!state.setupDraft.personality) return;
    showSetupStep(2);
    updateNameUi();
    if (els.setupScreen) els.setupScreen.scrollTop = 0;
    requestAnimationFrame(() => {
      els.personaNameInput.focus({ preventScroll: true });
    });
  }

  function goToPersonaStep() {
    showSetupStep(1);
    requestAnimationFrame(() => {
      const target =
        els.personaGrid.querySelector(".persona-card.is-selected") ||
        els.personaGrid.querySelector(".persona-card");
      target?.focus({ preventScroll: true });
    });
  }

  function showSetupStep(step, { focus = true } = {}) {
    const nameStep = step === 2;
    els.setupStep1.hidden = nameStep;
    els.setupStep2.hidden = !nameStep;

    els.setupProgressSteps.forEach((progressStep) => {
      const number = Number(progressStep.dataset.setupProgress);
      progressStep.classList.toggle("is-active", number === step);
      progressStep.classList.toggle("is-complete", number < step);
    });

    if (nameStep) {
      updateNameUi();
    } else if (focus) {
      const target =
        els.personaGrid.querySelector(".persona-card.is-selected") ||
        els.personaGrid.querySelector(".persona-card");
      target?.focus({ preventScroll: true });
    }
  }

  function updateNameUi() {
    const rawName = els.personaNameInput.value;
    const characters = Array.from(rawName);
    const normalized = normalizePersonaName(rawName);
    const initial = firstCharacter(normalized) || "她";

    els.nameCounter.textContent = `${characters.length} / ${LIMITS.personaNameCharacters}`;
    els.nameAvatarInitial.textContent = initial;
    els.nameField.classList.toggle("is-invalid", rawName.length > 0 && !normalized);
    els.setupFinishBtn.disabled = !state.setupDraft.personality || !normalized;

    updatePersonaSummary();
  }

  function setSetupFinishLabel() {
    const label = els.setupFinishBtn.querySelector("span");
    if (label) {
      label.textContent =
        state.setupMode === "edit" ? "保存她的设定" : "开始这段故事";
    }
  }

  function finishSetup() {
    const personalityId = state.setupDraft.personality;
    const name = normalizePersonaName(els.personaNameInput.value);

    if (!personalityId || !PERSONA_MAP[personalityId]) {
      showToast("先选择一种她的性格吧。", "info");
      showSetupStep(1);
      return;
    }

    if (!name) {
      showToast("还没有给她起名字呢。", "info");
      els.personaNameInput.focus();
      return;
    }

    const existing = state.persona;
    const changed =
      !existing ||
      existing.name !== name ||
      existing.personality !== personalityId;
    const hasUserConversation = state.sessions.some((session) =>
      session.messages.some((message) => message.role === "user")
    );

    if (changed && hasUserConversation) {
      const shouldContinue = window.confirm(
        `设置或修改角色会清空现有的 ${state.sessions.length} 段对话，并重新开始。请先保留需要的内容。要继续吗？`
      );
      if (!shouldContinue) return;
    }

    const now = new Date().toISOString();
    const profile = {
      name,
      personality: personalityId,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };

    const stored = savePersona(profile);
    if (!stored) {
      showToast("角色设定保存失败，原有角色和对话已保留。请检查浏览器存储空间后重试。", "error", 6000);
      return;
    }
    state.persona = profile;
    applyPersona(profile);

    if (!existing || changed) {
      resetConversationsForNewPersona();
      const greetingSession = createGreetingSession();
      clearComposer();
      document.documentElement.dataset.view = "chat";
      persistSessions();
      refreshUI({
        forceScroll: true,
        scrollMode: "auto",
        animateMessageId: greetingSession?.messages[0]?.id || null,
      });
      showToast(
        existing
          ? "她已按你的新设定，重新回到你身边。"
          : `${profile.name} 已经在等你了。`,
        "success",
        3600
      );
    } else {
      document.documentElement.dataset.view = "chat";
      ensureChatSession();
      persistSessions();
      refreshUI({ forceScroll: true, scrollMode: "auto" });
    }

    closeSidebar();
    focusComposerIfDesktop();
  }

  function closeSetup() {
    if (state.setupMode !== "edit" || !state.persona) return;

    applyPersona(state.persona);
    document.documentElement.dataset.view = "chat";
    refreshUI({ forceScroll: true, scrollMode: "auto" });
    closeSidebar();

    requestAnimationFrame(() => {
      els.personaSettingsBtn.focus({ preventScroll: true });
    });
  }

  function setPersonaTone(personalityId) {
    const persona = PERSONA_MAP[personalityId] || DEFAULT_PERSONA;
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty("--persona-tone", persona.tone);
    rootStyle.setProperty("--persona-tone-2", persona.tone2);
    rootStyle.setProperty("--persona-tone-rgb", persona.toneRgb);
    document.documentElement.dataset.personality = persona.id;
  }

  /* ------------------------------------------------------------------------
     Persona persistence and chrome
     ------------------------------------------------------------------------ */

  function loadPersona() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.persona);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;

      const name = normalizePersonaName(parsed.name);
      if (!name || !PERSONA_MAP[parsed.personality]) return null;

      return {
        name,
        personality: parsed.personality,
        createdAt: normalizeDate(parsed.createdAt),
        updatedAt: normalizeDate(parsed.updatedAt),
      };
    } catch (error) {
      return null;
    }
  }

  function savePersona(persona) {
    try {
      localStorage.setItem(STORAGE_KEYS.persona, JSON.stringify(persona));
      return true;
    } catch (error) {
      return false;
    }
  }

  function applyPersona(persona) {
    const info = PERSONA_MAP[persona.personality] || DEFAULT_PERSONA;
    setPersonaTone(info.id);
    updateHeader();
  }

  function updateHeader() {
    if (!state.persona) {
      els.conversationTitle.textContent = "她";
      els.topbarStatus.textContent = "AI 虚拟角色";
      els.topbarAvatarInitial.textContent = "她";
      document.title = "Aurora · 遇见你的 AI 女友";
      return;
    }

    const info = PERSONA_MAP[state.persona.personality] || DEFAULT_PERSONA;
    els.conversationTitle.textContent = state.persona.name;
    els.conversationTitle.title = state.persona.name;
    els.topbarStatus.textContent = `${info.label} · AI 虚拟角色`;
    els.topbarAvatarInitial.textContent = firstCharacter(state.persona.name) || "她";
    els.messageInput.placeholder = `对${state.persona.name}说点什么…`;
    document.title = `${state.persona.name} · Aurora AI 女友`;
  }

  function normalizePersonaName(value) {
    if (typeof value !== "string") return "";
    const cleaned = value.trim().replace(/\s+/g, " ");
    if (!cleaned) return "";
    if (Array.from(cleaned).some((character) => character.charCodeAt(0) < 32)) {
      return "";
    }
    return Array.from(cleaned).slice(0, LIMITS.personaNameCharacters).join("");
  }

  function firstCharacter(value) {
    return Array.from(String(value || "").trim())[0] || "";
  }

  /* ------------------------------------------------------------------------
     Composer
     ------------------------------------------------------------------------ */

  function handleComposerSubmit(event) {
    event.preventDefault();

    if (document.documentElement.dataset.view !== "chat" || !state.persona) {
      return;
    }

    if (state.isLoading) {
      stopGeneration();
      return;
    }

    if (state.fatal) {
      showToast("页面依赖没有加载完成，请刷新后重试。", "error");
      return;
    }

    const text = els.messageInput.value.trim();
    if (!text) return;
    sendMessage(text);
  }

  function handleInput() {
    autoResizeInput();
    updateSendButton();
    updateCharacterCount();
  }

  function handleInputKeydown(event) {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.isComposing &&
      !messageInputComposing
    ) {
      event.preventDefault();
      if (!state.isLoading) {
        els.composer.requestSubmit();
      }
    }
  }

  function handleGlobalKeydown(event) {
    if (document.documentElement.dataset.view === "setup") {
      if (
        event.key === "Escape" &&
        state.setupMode === "edit" &&
        state.persona
      ) {
        event.preventDefault();
        closeSetup();
      }
      return;
    }

    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k") {
      event.preventDefault();
      startNewChat();
      return;
    }

    if (event.key === "Escape" && state.sidebarOpen) {
      event.preventDefault();
      closeSidebar();
    }
  }

  function autoResizeInput() {
    const input = els.messageInput;
    input.style.height = "0px";
    const nextHeight = Math.min(Math.max(input.scrollHeight, 28), 170);
    input.style.height = `${nextHeight}px`;
  }

  function updateSendButton() {
    const hasText = els.messageInput.value.trim().length > 0;
    const isLoading = state.isLoading;
    const inChat = document.documentElement.dataset.view === "chat";

    els.sendButton.disabled =
      state.fatal || !state.persona || !inChat || (!isLoading && !hasText);
    els.sendButton.classList.toggle("is-loading", isLoading);
    els.sendButton.setAttribute("aria-label", isLoading ? "停止回复" : "发送消息");
    els.sendButton.title = isLoading ? "停止回复" : "发送消息";
  }

  function updateCharacterCount() {
    const length = els.messageInput.value.length;
    if (length === 0) {
      els.characterCount.textContent = "";
      els.characterCount.classList.remove("is-limit");
      return;
    }

    els.characterCount.textContent = `${length.toLocaleString("zh-CN")} / ${LIMITS.inputCharacters.toLocaleString("zh-CN")}`;
    els.characterCount.classList.toggle("is-limit", length >= LIMITS.inputCharacters - 500);
  }

  function clearComposer() {
    els.messageInput.value = "";
    els.messageInput.style.height = "28px";
    updateSendButton();
    updateCharacterCount();
  }

  function focusComposerIfDesktop() {
    if (
      document.documentElement.dataset.view === "chat" &&
      window.matchMedia("(pointer: fine)").matches
    ) {
      els.messageInput.focus();
    }
  }

  /* ------------------------------------------------------------------------
     Sending and model requests
     ------------------------------------------------------------------------ */

  function sendMessage(rawText) {
    const text = rawText.trim();
    if (
      !text ||
      state.isLoading ||
      !state.persona ||
      document.documentElement.dataset.view !== "chat"
    ) {
      return;
    }

    let session = getActiveSession();
    let sessionWasCreated = false;

    if (text.length > LIMITS.inputCharacters) {
      showToast("消息过长，请缩短到 12,000 字符以内后重试。", "error");
      return;
    }

    if (!session) {
      session = createGreetingSession();
      if (!session) return;
      sessionWasCreated = true;
    }

    const hasUserMessages = session.messages.some(
      (message) => message.role === "user"
    );
    const previousTitle = session.title;
    const previousUpdatedAt = session.updatedAt;

    const userMessage = {
      id: makeId("m"),
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };

    session.messages.push(userMessage);
    if (!hasUserMessages) {
      session.title = makeSessionTitle(text);
    }
    session.updatedAt = new Date().toISOString();
    state.activeSessionId = session.id;

    persistSessions();
    clearComposer();

    const history = buildContextMessages(session);
    if (!history.length) {
      rollbackRequest({
        sessionId: session.id,
        userMessageId: userMessage.id,
        sessionWasCreated,
        previousTitle,
        previousUpdatedAt,
        restoreInput: true,
        originalText: text,
        previousAssistant: null,
      });
      persistSessions();
      refreshUI({ forceScroll: true });
      showToast("没有可发送的对话内容，请重试。", "error");
      return;
    }

    performChatRequest({
      sessionId: session.id,
      history,
      previousAssistant: null,
      meta: {
        userMessageId: userMessage.id,
        sessionWasCreated,
        previousTitle,
        previousUpdatedAt,
        originalText: text,
        restoreInput: true,
        cancelMessage: "已停下，你的话我还没忘。",
      },
    });
  }

  async function performChatRequest({ sessionId, history, meta, previousAssistant }) {
    if (!api || !state.persona) {
      showToast("暂时无法连接后端服务。", "error");
      return;
    }

    const controller = new AbortController();
    const requestId = ++state.requestSequence;
    const request = {
      id: requestId,
      controller,
      sessionId,
      previousAssistant,
      ...meta,
    };

    state.activeRequest = request;
    state.isLoading = true;
    updateSendButton();
    refreshUI({
      forceScroll: true,
      animateMessageId: meta.userMessageId || null,
    });

    try {
      const response = await api.post(
        "/api/chat",
        {
          messages: history,
          persona: {
            name: state.persona.name,
            personality: state.persona.personality,
          },
        },
        { signal: controller.signal }
      );

      if (!isCurrentRequest(requestId)) return;

      const data = response && response.data ? response.data : null;
      if (!data || typeof data.reply !== "string" || !data.reply.trim()) {
        const invalid = new Error("Model returned an empty reply");
        invalid.code = "BAD_RESPONSE";
        throw invalid;
      }

      const currentSession = findSessionById(sessionId);
      state.activeRequest = null;
      state.isLoading = false;
      updateSendButton();

      if (!currentSession) {
        refreshUI({ forceScroll: true });
        return;
      }

      const assistantMessage = {
        id: makeId("m"),
        role: "assistant",
        content: data.reply.trim(),
        createdAt: new Date().toISOString(),
      };

      currentSession.messages.push(assistantMessage);
      currentSession.updatedAt = assistantMessage.createdAt;

      persistSessions();
      refreshUI({
        forceScroll: true,
        animateMessageId: assistantMessage.id,
      });
    } catch (error) {
      if (!isCurrentRequest(requestId)) return;

      state.activeRequest = null;
      state.isLoading = false;
      updateSendButton();
      rollbackRequest(request);
      persistSessions();
      refreshUI({ forceScroll: true });

      if (!isCancellation(error)) {
        showToast(friendlyErrorMessage(error), "error", 5600);
        focusComposerIfDesktop();
      }
    }
  }

  function stopGeneration() {
    if (!state.isLoading || !state.activeRequest) return;
    const message = state.activeRequest.cancelMessage || "已停止回复。";
    cancelActiveRequest({ toastMessage: message });
    focusComposerIfDesktop();
  }

  function cancelActiveRequest({ toastMessage = null } = {}) {
    const request = state.activeRequest;
    if (!request) return false;

    // Invalidate the request before aborting so its catch handler stays quiet.
    state.activeRequest = null;
    state.isLoading = false;
    request.controller.abort();
    rollbackRequest(request);
    persistSessions();
    refreshUI({ forceScroll: true });
    updateSendButton();

    if (toastMessage) {
      showToast(toastMessage, "info", 3200);
    }

    return true;
  }

  function isCurrentRequest(requestId) {
    return Boolean(state.activeRequest && state.activeRequest.id === requestId);
  }

  function isCancellation(error) {
    return Boolean(
      (window.axios && window.axios.isCancel && window.axios.isCancel(error)) ||
        error?.code === "ERR_CANCELED" ||
        error?.name === "CanceledError"
    );
  }

  function rollbackRequest(request) {
    if (!request) return;

    const session = findSessionById(request.sessionId);
    if (!session) return;

    if (request.userMessageId) {
      const index = session.messages.findIndex(
        (message) => message.id === request.userMessageId
      );
      if (index >= 0) session.messages.splice(index, 1);

      if (request.previousTitle) session.title = request.previousTitle;
      if (request.previousUpdatedAt) session.updatedAt = request.previousUpdatedAt;

      if (request.sessionWasCreated && session.messages.length === 0) {
        state.sessions = state.sessions.filter((item) => item.id !== session.id);
        if (state.activeSessionId === session.id) {
          state.activeSessionId = null;
        }
      }
    }

    if (request.previousAssistant) {
      const alreadyThere = session.messages.some(
        (message) => message.id === request.previousAssistant.id
      );
      if (!alreadyThere) {
        session.messages.push(request.previousAssistant);
        if (request.previousUpdatedAt) session.updatedAt = request.previousUpdatedAt;
      }
    }

    if (request.restoreInput && !els.messageInput.value.trim()) {
      els.messageInput.value = request.originalText || "";
      autoResizeInput();
      updateSendButton();
      updateCharacterCount();
    }
  }

  function regenerateLastReply() {
    if (state.isLoading || !state.persona) return;

    const session = getActiveSession();
    if (!session || !session.messages.length) return;

    const hasUserMessages = session.messages.some(
      (message) => message.role === "user"
    );
    const lastMessage = session.messages[session.messages.length - 1];
    if (
      !hasUserMessages ||
      lastMessage.role !== "assistant" ||
      lastMessage.kind === "greeting"
    ) {
      return;
    }

    const previousUpdatedAt = session.updatedAt;
    session.messages.pop();
    session.updatedAt = new Date().toISOString();

    const history = buildContextMessages(session);
    if (!history.length || history[history.length - 1].role !== "user") {
      session.messages.push(lastMessage);
      session.updatedAt = previousUpdatedAt;
      persistSessions();
      refreshUI({ forceScroll: true });
      showToast("没有可以重新回应的上一条消息。", "error");
      return;
    }

    persistSessions();
    refreshUI({ forceScroll: true });

    performChatRequest({
      sessionId: session.id,
      history,
      previousAssistant: lastMessage,
      meta: {
        userMessageId: null,
        sessionWasCreated: false,
        previousTitle: null,
        previousUpdatedAt,
        originalText: "",
        restoreInput: false,
        cancelMessage: "好，这次先听你的。",
      },
    });
  }

  function buildContextMessages(session) {
    const eligible = session.messages.filter(
      (message) =>
        (message.role === "user" || message.role === "assistant") &&
        message.kind !== "greeting" &&
        typeof message.content === "string" &&
        message.content.trim().length > 0
    );

    const recent = eligible.slice(-LIMITS.maxContextMessages);
    const selected = [];
    let characterCount = 0;

    for (let index = recent.length - 1; index >= 0; index -= 1) {
      const message = recent[index];
      // Limit API context only; keep the complete answer in history and the UI.
      const content = Array.from(message.content).slice(0, LIMITS.maxMessageCharacters).join("");
      const nextCount = characterCount + content.length;
      if (selected.length && nextCount > LIMITS.maxContextCharacters) break;
      selected.unshift({ role: message.role, content });
      characterCount = nextCount;
    }

    while (selected.length && selected[0].role !== "user") {
      selected.shift();
    }

    return selected;
  }

  async function checkHealth() {
    if (!api) {
      setConnectionUI("offline", "依赖未加载", "请刷新页面");
      return;
    }

    setConnectionUI("checking", "正在连接服务", "读取模型配置…");

    try {
      const response = await api.get("/api/health", { timeout: 8000 });
      const data = response.data || {};

      if (data.configured) {
        state.health = { configured: true, model: data.model || "未知模型" };
        setConnectionUI("online", "凭据已配置", `模型 · ${data.model || "未知"}（可用性未验证）`);
      } else {
        state.health = { configured: false, model: data.model || "未知模型" };
        setConnectionUI("offline", "API 未配置", "请在 .env 中填写密钥");
        showToast(
          "后端尚未配置 API 凭据，请在 .env 中填写 ANTHROPIC_API_KEY 后重启服务。",
          "error",
          6500
        );
      }
    } catch (error) {
      state.health = null;
      setConnectionUI("offline", "后端未连接", "请确认 FastAPI 已启动");
      showToast("无法连接后端服务，请确认服务已经启动。", "error", 5000);
    }
  }

  /* ------------------------------------------------------------------------
     Session management
     ------------------------------------------------------------------------ */

  function createGreetingSession() {
    if (!state.persona) return null;

    const now = new Date().toISOString();
    const greetingMessage = createGreetingMessage(now);
    const session = {
      id: makeId("s"),
      title: "新的故事",
      createdAt: now,
      updatedAt: now,
      messages: greetingMessage ? [greetingMessage] : [],
    };

    state.sessions.unshift(session);
    state.activeSessionId = session.id;
    return session;
  }

  function createGreetingMessage(createdAt = new Date().toISOString()) {
    if (!state.persona) return null;
    return {
      id: makeId("m"),
      role: "assistant",
      content: buildGreeting(state.persona),
      createdAt,
      kind: "greeting",
    };
  }

  function buildGreeting(persona) {
    const timeGreeting = getTimeGreeting();
    const template =
      PERSONA_MAP[persona.personality]?.greeting || DEFAULT_PERSONA.greeting;
    return template
      .replace(/\{name\}/g, persona.name)
      .replace(/\{time\}/g, timeGreeting);
  }

  function getTimeGreeting() {
    const hour = new Date().getHours();
    if (hour < 5) return "这么晚还没睡";
    if (hour < 11) return "早安";
    if (hour < 14) return "中午好";
    if (hour < 18) return "下午好";
    return "晚上好";
  }

  function ensureChatSession() {
    if (!state.persona) return null;

    if (!state.sessions.length) {
      return createGreetingSession();
    }

    let session = getActiveSession();
    if (!session) {
      session = getSortedSessions()[0] || null;
      state.activeSessionId = session ? session.id : null;
    }

    if (session && session.messages.length === 0) {
      const greeting = createGreetingMessage();
      if (greeting) {
        session.messages.push(greeting);
        session.updatedAt = new Date().toISOString();
      }
    }

    return session;
  }

  function startNewChat() {
    if (
      !state.persona ||
      document.documentElement.dataset.view !== "chat"
    ) {
      return;
    }

    if (state.isLoading) cancelActiveRequest();
    closeSidebar();

    const current = getActiveSession();
    const currentHasUserMessages = Boolean(
      current?.messages.some((message) => message.role === "user")
    );

    if (current && !currentHasUserMessages) {
      focusComposerIfDesktop();
      return;
    }

    const session = createGreetingSession();
    clearComposer();
    persistSessions();
    refreshUI({
      forceScroll: true,
      scrollMode: "auto",
      animateMessageId: session?.messages[0]?.id || null,
    });
    focusComposerIfDesktop();
  }

  function selectSession(sessionId) {
    const session = findSessionById(sessionId);
    if (!session) return;

    if (sessionId === state.activeSessionId) {
      closeSidebar();
      focusComposerIfDesktop();
      return;
    }

    if (state.isLoading) cancelActiveRequest();
    clearComposer();
    state.activeSessionId = sessionId;
    persistSessions();
    refreshUI({ forceScroll: true });
    closeSidebar();
    focusComposerIfDesktop();
  }

  function deleteSession(sessionId) {
    const session = findSessionById(sessionId);
    if (!session) return;

    if (state.activeRequest && state.activeRequest.sessionId === sessionId) {
      cancelActiveRequest();
    }

    state.sessions = state.sessions.filter((item) => item.id !== sessionId);

    if (state.activeSessionId === sessionId) {
      const nextSession = getSortedSessions()[0] || null;
      state.activeSessionId = nextSession ? nextSession.id : null;
      clearComposer();
    }

    if (!state.sessions.length) {
      createGreetingSession();
    }

    persistSessions();
    refreshUI({ forceScroll: true });
    showToast("这段故事已删除。", "success", 2200);
  }

  function clearAllSessions() {
    if (document.documentElement.dataset.view !== "chat" || !state.persona) {
      return;
    }

    if (!window.confirm("确定要清空你和她的全部对话吗？这会重新开始你们的故事。")) {
      return;
    }

    if (state.activeRequest) cancelActiveRequest();
    state.sessions = [];
    state.activeSessionId = null;
    removeSessionStorage();
    clearComposer();

    const session = createGreetingSession();
    persistSessions();
    refreshUI({
      forceScroll: true,
      scrollMode: "auto",
      animateMessageId: session?.messages[0]?.id || null,
    });
    showToast("对话已清空，她重新和你打了招呼。", "success", 2800);
  }

  function resetConversationsForNewPersona() {
    state.sessions = [];
    state.activeSessionId = null;
    removeSessionStorage();
  }

  function removeSessionStorage() {
    try {
      localStorage.removeItem(STORAGE_KEYS.sessions);
      localStorage.removeItem(STORAGE_KEYS.activeSession);
    } catch (error) {
      // Storage is optional; memory was already cleared.
    }
  }

  function getActiveSession() {
    return findSessionById(state.activeSessionId);
  }

  function findSessionById(sessionId) {
    if (!sessionId) return null;
    return state.sessions.find((session) => session.id === sessionId) || null;
  }

  function getSortedSessions() {
    return state.sessions.slice().sort(compareSessions);
  }

  function compareSessions(a, b) {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  }

  function makeSessionTitle(text) {
    const cleaned = String(text || "")
      .replace(/[#>*_`~[\]()]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleaned) return "新的故事";
    const characters = Array.from(cleaned);
    return characters.length > 26 ? `${characters.slice(0, 26).join("")}…` : cleaned;
  }

  function makeId(prefix) {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return `${prefix}_${window.crypto.randomUUID()}`;
    }
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  function loadSessions() {
    let rawSessions = [];
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.sessions);
      const parsed = saved ? JSON.parse(saved) : [];
      if (Array.isArray(parsed)) rawSessions = parsed;
    } catch (error) {
      rawSessions = [];
    }

    const seenIds = new Set();
    const sessions = [];

    rawSessions.forEach((rawSession) => {
      const session = normalizeStoredSession(rawSession, seenIds);
      if (session) sessions.push(session);
    });

    sessions.sort(compareSessions);
    state.sessions = sessions.slice(0, LIMITS.maxSessions);

    let savedActiveId = null;
    try {
      savedActiveId = localStorage.getItem(STORAGE_KEYS.activeSession);
    } catch (error) {
      savedActiveId = null;
    }

    if (savedActiveId && findSessionById(savedActiveId)) {
      state.activeSessionId = savedActiveId;
    } else {
      state.activeSessionId = state.sessions[0]?.id || null;
    }
  }

  function normalizeStoredSession(raw, seenIds) {
    if (!raw || typeof raw !== "object") return null;
    if (!Array.isArray(raw.messages) || raw.messages.length === 0) return null;

    const messages = [];
    raw.messages.forEach((rawMessage) => {
      if (!rawMessage || typeof rawMessage !== "object") return;
      if (rawMessage.role !== "user" && rawMessage.role !== "assistant") return;
      if (typeof rawMessage.content !== "string" || !rawMessage.content.trim()) return;

      const message = {
        id: typeof rawMessage.id === "string" && rawMessage.id ? rawMessage.id : makeId("m"),
        role: rawMessage.role,
        content: rawMessage.content,
        createdAt: normalizeDate(rawMessage.createdAt),
      };
      if (rawMessage.kind === "greeting") message.kind = "greeting";
      messages.push(message);
    });

    if (!messages.length) return null;

    let id = typeof raw.id === "string" && raw.id ? raw.id : makeId("s");
    if (seenIds.has(id)) id = makeId("s");
    seenIds.add(id);

    const firstUserMessage = messages.find((message) => message.role === "user");
    const fallbackTitle = firstUserMessage ? makeSessionTitle(firstUserMessage.content) : "新的故事";
    const title =
      typeof raw.title === "string" && raw.title.trim()
        ? raw.title.trim().slice(0, 60)
        : fallbackTitle;

    const createdAt = normalizeDate(raw.createdAt);
    const updatedAt = normalizeDate(raw.updatedAt || messages[messages.length - 1].createdAt);

    return {
      id,
      title,
      createdAt,
      updatedAt,
      messages,
    };
  }

  function normalizeDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  function persistSessions() {
    state.sessions.sort(compareSessions);

    if (state.sessions.length > LIMITS.maxSessions) {
      state.sessions = state.sessions.slice(0, LIMITS.maxSessions);
      if (!findSessionById(state.activeSessionId)) {
        state.activeSessionId = state.sessions[0]?.id || null;
      }
    }

    try {
      localStorage.setItem(STORAGE_KEYS.sessions, JSON.stringify(state.sessions));
      if (state.activeSessionId) {
        localStorage.setItem(STORAGE_KEYS.activeSession, state.activeSessionId);
      } else {
        localStorage.removeItem(STORAGE_KEYS.activeSession);
      }
    } catch (error) {
      if (!state.storageWarned) {
        state.storageWarned = true;
        showToast("浏览器存储空间不足，当前对话可能无法保存。", "error", 6000);
      }
    }
  }

  /* ------------------------------------------------------------------------
     Rendering
     ------------------------------------------------------------------------ */

  function refreshUI({ forceScroll = false, scrollMode = "smooth", animateMessageId = null } = {}) {
    updateHeader();
    renderHistory();
    renderConversation({ forceScroll, scrollMode, animateMessageId });
    updateSendButton();
    els.chatStage.setAttribute("aria-busy", state.isLoading ? "true" : "false");
  }

  function renderHistory() {
    const sessions = getSortedSessions();
    els.historyCount.textContent = String(sessions.length);
    els.historyEmpty.hidden = sessions.length > 0;
    els.historyList.replaceChildren();

    sessions.forEach((session) => {
      const item = document.createElement("div");
      item.className = "history-item";
      if (session.id === state.activeSessionId) {
        item.classList.add("is-active");
      }

      const openButton = document.createElement("button");
      openButton.type = "button";
      openButton.className = "history-item__open";
      openButton.setAttribute("aria-label", `打开对话：${session.title}`);
      if (session.id === state.activeSessionId) {
        openButton.setAttribute("aria-current", "true");
      }

      const glyph = document.createElement("span");
      glyph.className = "history-item__glyph";
      glyph.setAttribute("aria-hidden", "true");
      glyph.innerHTML = '<svg viewBox="0 0 24 24"><use href="#i-heart"></use></svg>';

      const text = document.createElement("span");
      text.className = "history-item__text";

      const title = document.createElement("span");
      title.className = "history-item__title";
      title.textContent = session.title;

      const time = document.createElement("span");
      time.className = "history-item__time";
      time.textContent = formatRelativeTime(session.updatedAt);

      text.append(title, time);
      openButton.append(glyph, text);
      openButton.addEventListener("click", () => selectSession(session.id));

      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "history-item__delete";
      deleteButton.setAttribute("aria-label", `删除对话：${session.title}`);
      deleteButton.title = "删除对话";
      deleteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-trash"></use></svg>';
      deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        deleteSession(session.id);
      });

      item.append(openButton, deleteButton);
      els.historyList.appendChild(item);
    });
  }

  function renderConversation({ forceScroll = false, scrollMode = "smooth", animateMessageId = null } = {}) {
    const session = getActiveSession();
    const messages = session ? session.messages : [];
    const wasNearBottom = isNearBottom();
    const hasUserMessages = messages.some((message) => message.role === "user");

    els.messages.replaceChildren();

    if (session) {
      const lastAssistant = [...messages]
        .reverse()
        .find((message) => message.role === "assistant");

      messages.forEach((message) => {
        const canRegenerate =
          !state.isLoading &&
          hasUserMessages &&
          message.role === "assistant" &&
          message.kind !== "greeting" &&
          lastAssistant &&
          message.id === lastAssistant.id;
        const animate = Boolean(animateMessageId && animateMessageId === message.id);
        els.messages.appendChild(buildMessageElement(message, { canRegenerate, animate }));
      });

      if (state.isLoading) {
        els.messages.appendChild(buildTypingIndicator());
      }
    }

    requestAnimationFrame(() => {
      if (!messages.length) {
        els.chatStage.scrollTop = 0;
        updateScrollButton();
        return;
      }

      if (forceScroll || wasNearBottom) {
        scrollToBottom(scrollMode);
      } else {
        updateScrollButton();
      }
    });
  }

  function buildMessageElement(message, { canRegenerate, animate }) {
    const article = document.createElement("article");
    article.className = `message ${message.role}`;
    if (message.kind === "greeting") article.classList.add("is-greeting");
    article.dataset.messageId = message.id;
    if (animate) article.classList.add("is-new");

    const avatar = document.createElement("div");
    avatar.className = `avatar avatar--${message.role}`;
    avatar.setAttribute("aria-hidden", "true");
    if (message.role === "assistant") {
      avatar.textContent = firstCharacter(state.persona?.name) || "她";
    } else {
      avatar.innerHTML = '<svg viewBox="0 0 24 24"><use href="#i-user"></use></svg>';
    }

    const content = document.createElement("div");
    content.className = "message__content";

    const meta = document.createElement("div");
    meta.className = "message__meta";

    const author = document.createElement("span");
    author.className = "message__author";
    author.textContent =
      message.role === "assistant" ? state.persona?.name || "她" : "你";

    const time = document.createElement("time");
    time.className = "message__time";
    time.dateTime = message.createdAt;
    time.textContent = formatMessageTime(message.createdAt);

    meta.append(author);
    if (message.role === "assistant") {
      const aiBadge = document.createElement("span");
      aiBadge.className = "ai-badge";
      aiBadge.textContent = "AI";
      aiBadge.title = "AI 虚拟角色";
      meta.append(aiBadge);
    }
    meta.append(time);

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    if (message.role === "assistant") {
      bubble.classList.add("markdown-body");
      renderMarkdownInto(bubble, message.content);
    } else {
      bubble.textContent = message.content;
    }

    const actions = document.createElement("div");
    actions.className = "message__actions";

    const copyAction = createMessageAction("i-copy", "复制", async (button) => {
      const copied = await copyText(message.content);
      if (!copied) {
        showToast("复制失败，请手动选择文本。", "error");
        return;
      }
      flashActionLabel(button, "已复制");
    });
    actions.appendChild(copyAction);

    if (canRegenerate) {
      const regenerateAction = createMessageAction("i-refresh", "换一句", () => {
        regenerateLastReply();
      });
      actions.appendChild(regenerateAction);
    }

    content.append(meta, bubble, actions);
    article.append(avatar, content);
    return article;
  }

  function buildTypingIndicator() {
    const name = state.persona?.name || "她";
    const article = document.createElement("article");
    article.className = "message assistant is-new";
    article.setAttribute("aria-label", `${name}正在输入`);

    const avatar = document.createElement("div");
    avatar.className = "avatar avatar--assistant";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = firstCharacter(name) || "她";

    const content = document.createElement("div");
    content.className = "message__content";

    const meta = document.createElement("div");
    meta.className = "message__meta";
    const author = document.createElement("span");
    author.className = "message__author";
    author.textContent = name;
    const aiBadge = document.createElement("span");
    aiBadge.className = "ai-badge";
    aiBadge.textContent = "AI";
    const status = document.createElement("span");
    status.className = "message__time";
    status.textContent = "正在输入…";
    meta.append(author, aiBadge, status);

    const bubble = document.createElement("div");
    bubble.className = "bubble typing-bubble";
    bubble.setAttribute("aria-hidden", "true");
    for (let index = 0; index < 3; index += 1) {
      const dot = document.createElement("span");
      dot.className = "typing-dot";
      bubble.appendChild(dot);
    }

    content.append(meta, bubble);
    article.append(avatar, content);
    return article;
  }

  function createMessageAction(iconId, label, onActivate) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "message-action";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#${iconId}"></use></svg><span></span>`;
    button.querySelector("span").textContent = label;
    button.addEventListener("click", () => onActivate(button));
    return button;
  }

  function flashActionLabel(button, label) {
    const textNode = button.querySelector("span");
    if (!textNode) return;
    const original = textNode.textContent;
    textNode.textContent = label;
    window.setTimeout(() => {
      textNode.textContent = original;
    }, 1500);
  }

  function renderMarkdownInto(container, markdown) {
    if (
      !window.marked ||
      typeof window.marked.parse !== "function" ||
      !window.DOMPurify ||
      typeof window.DOMPurify.sanitize !== "function"
    ) {
      container.textContent = markdown;
      container.style.whiteSpace = "pre-wrap";
      return;
    }

    try {
      const rawHtml = String(
        window.marked.parse(markdown, {
          gfm: true,
          breaks: true,
        })
      );

      const safeHtml = window.DOMPurify.sanitize(rawHtml, {
        ADD_ATTR: ["target", "rel"],
        FORBID_TAGS: ["style", "iframe", "form", "input", "button", "textarea", "select"],
        FORBID_ATTR: ["style"],
      });

      container.innerHTML = safeHtml;
      decorateRenderedMarkdown(container);
    } catch (error) {
      container.textContent = markdown;
      container.style.whiteSpace = "pre-wrap";
    }
  }

  function decorateRenderedMarkdown(container) {
    container.querySelectorAll("a").forEach((link) => {
      link.target = "_blank";
      link.rel = "noopener noreferrer nofollow";
    });

    container.querySelectorAll("img").forEach((image) => {
      const source = image.getAttribute("src") || "";
      if (!/^https?:\/\//i.test(source)) {
        image.remove();
        return;
      }
      image.loading = "lazy";
      image.decoding = "async";
      image.referrerPolicy = "no-referrer";
    });

    container.querySelectorAll("table").forEach((table) => {
      if (table.parentElement?.classList.contains("table-scroll")) return;
      const wrapper = document.createElement("div");
      wrapper.className = "table-scroll";
      table.replaceWith(wrapper);
      wrapper.appendChild(table);
    });

    container.querySelectorAll("pre").forEach((pre) => {
      if (pre.closest(".code-block")) return;

      const code = pre.querySelector("code");
      const rawCode = code ? code.textContent || "" : pre.textContent || "";
      const languageClass = code
        ? Array.from(code.classList).find((name) => name.startsWith("language-"))
        : null;
      const language = (languageClass ? languageClass.slice(9) : "code")
        .replace(/[^a-z0-9+#.-]/gi, "")
        .slice(0, 24) || "code";

      const wrapper = document.createElement("div");
      wrapper.className = "code-block";

      const header = document.createElement("div");
      header.className = "code-block__header";

      const languageLabel = document.createElement("span");
      languageLabel.className = "code-block__lang";
      languageLabel.textContent = language;

      const copyButton = document.createElement("button");
      copyButton.type = "button";
      copyButton.className = "code-block__copy";
      copyButton.setAttribute("aria-label", "复制代码");
      copyButton.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#i-copy"></use></svg><span>复制</span>';
      copyButton.addEventListener("click", async () => {
        const copied = await copyText(rawCode);
        const label = copyButton.querySelector("span");
        if (!copied) {
          showToast("复制失败，请手动选择代码。", "error");
          return;
        }
        copyButton.classList.add("is-copied");
        if (label) label.textContent = "已复制";
        window.setTimeout(() => {
          copyButton.classList.remove("is-copied");
          if (label) label.textContent = "复制";
        }, 1600);
      });

      header.append(languageLabel, copyButton);
      pre.replaceWith(wrapper);
      wrapper.append(header, pre);
    });
  }

  /* ------------------------------------------------------------------------
     Status, theme, sidebar, shortcuts
     ------------------------------------------------------------------------ */

  function setConnectionUI(kind, label, detail) {
    els.statusDot.classList.remove("is-checking", "is-online", "is-offline");
    els.statusDot.classList.add(`is-${kind}`);
    els.statusText.textContent = label;
    els.statusModel.textContent = detail;
  }

  function toggleTheme() {
    const current = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEYS.theme, next);
    } catch (error) {
      // Theme persistence is best-effort.
    }
    syncThemeUI();
  }

  function syncThemeUI() {
    const isLight = document.documentElement.dataset.theme === "light";
    els.themeLabel.textContent = isLight ? "切换到深色" : "切换到浅色";
    els.themeToggle.setAttribute(
      "aria-label",
      isLight ? "切换到深色主题" : "切换到浅色主题"
    );
    if (els.themeMeta) {
      els.themeMeta.setAttribute("content", isLight ? "#fff7fa" : "#0b0710");
    }
  }

  function openSidebar() {
    if (!MOBILE_SIDEBAR.matches) return;
    state.sidebarOpen = true;
    document.body.classList.add("sidebar-open");
    els.openSidebarBtn.setAttribute("aria-expanded", "true");
    if (els.main) els.main.inert = true;
    syncSidebarInert();
    window.setTimeout(() => {
      if (state.sidebarOpen) els.sidebarCloseBtn.focus();
    }, 260);
  }

  function closeSidebar() {
    const wasOpen = state.sidebarOpen || document.body.classList.contains("sidebar-open");
    state.sidebarOpen = false;
    document.body.classList.remove("sidebar-open");
    els.openSidebarBtn.setAttribute("aria-expanded", "false");
    if (els.main) els.main.inert = false;
    syncSidebarInert();
    if (wasOpen && MOBILE_SIDEBAR.matches) {
      window.requestAnimationFrame(() => {
        if (!state.sidebarOpen) els.openSidebarBtn.focus({ preventScroll: true });
      });
    }
  }

  function syncSidebarInert() {
    if (!els.sidebar) return;
    els.sidebar.inert = MOBILE_SIDEBAR.matches && !state.sidebarOpen;
  }

  function syncShortcutLabel() {
    if (els.newChatShortcut) els.newChatShortcut.textContent = SHORTCUT_LABEL;
    els.newChatBtn.title = `开启新对话 (${SHORTCUT_LABEL})`;
    els.newChatTopBtn.title = `开启新对话 (${SHORTCUT_LABEL})`;
  }

  /* ------------------------------------------------------------------------
     Scrolling
     ------------------------------------------------------------------------ */

  function isNearBottom() {
    return (
      els.chatStage.scrollHeight - els.chatStage.scrollTop - els.chatStage.clientHeight <
      140
    );
  }

  function scrollToBottom(mode = "smooth") {
    const preferredMode = REDUCED_MOTION.matches ? "auto" : mode;
    els.chatStage.scrollTo({
      top: els.chatStage.scrollHeight,
      behavior: preferredMode,
    });
    updateScrollButton();
  }

  function updateScrollButton() {
    const hasConversation = Boolean(getActiveSession()?.messages.length);
    const show = hasConversation && !isNearBottom();
    els.scrollToBottom.classList.toggle("is-visible", show);
  }

  /* ------------------------------------------------------------------------
     Utilities
     ------------------------------------------------------------------------ */

  function formatMessageTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return timeFormatter.format(date);
  }

  function formatRelativeTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "刚刚";

    const now = new Date();
    const difference = now.getTime() - date.getTime();
    if (difference < 60_000) return "刚刚";
    if (difference < 3_600_000) return `${Math.floor(difference / 60_000)} 分钟前`;

    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    const dayDifference = Math.round((startOfToday - startOfDate) / 86_400_000);

    if (dayDifference === 0) return `今天 ${timeFormatter.format(date)}`;
    if (dayDifference === 1) return `昨天 ${timeFormatter.format(date)}`;
    if (dayDifference > 1 && dayDifference < 7) return `${dayDifference} 天前`;
    if (date.getFullYear() === now.getFullYear()) {
      return `${date.getMonth() + 1} 月 ${date.getDate()} 日`;
    }
    return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  }

  function friendlyErrorMessage(error) {
    if (error?.code === "BAD_RESPONSE") {
      return "她没有说出完整的话，请再试一次。";
    }

    if (error?.code === "ECONNABORTED" || error?.code === "ETIMEDOUT") {
      return "回应等得有点久了，请稍后重试。";
    }

    if (!error?.response) {
      return "无法连接后端服务，请确认 FastAPI 已启动后重试。";
    }

    const detail = error.response.data?.detail;
    if (Array.isArray(detail)) {
      const messages = detail
        .map((item) => (typeof item?.msg === "string" ? item.msg : null))
        .filter(Boolean);
      if (messages.length) return messages.join("；");
    }

    if (typeof detail === "string" && detail.trim()) {
      return detail.trim();
    }

    if (error.response.status >= 500) {
      return "她暂时有点走神，请稍后再试。";
    }

    return "消息没有送达，请稍后再试。";
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
      // Fall through to the textarea fallback.
    }

    try {
      const helper = document.createElement("textarea");
      helper.value = text;
      helper.setAttribute("readonly", "");
      helper.style.position = "fixed";
      helper.style.top = "-9999px";
      helper.style.opacity = "0";
      document.body.appendChild(helper);
      helper.select();
      const succeeded = document.execCommand("copy");
      helper.remove();
      return succeeded;
    } catch (error) {
      return false;
    }
  }

  function showToast(message, type = "info", duration = 3200) {
    if (!els.toastRegion) return;

    const toast = document.createElement("div");
    toast.className = `toast toast--${type}`;

    const iconId = type === "error" ? "i-alert" : type === "success" ? "i-check" : "i-heart";
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.innerHTML = `<svg viewBox="0 0 24 24"><use href="#${iconId}"></use></svg>`;

    const text = document.createElement("span");
    text.textContent = message;

    toast.append(icon, text);
    els.toastRegion.appendChild(toast);

    while (els.toastRegion.children.length > 3) {
      els.toastRegion.firstElementChild.remove();
    }

    window.setTimeout(() => {
      toast.classList.add("is-leaving");
      window.setTimeout(() => toast.remove(), 240);
    }, duration);
  }
})();
