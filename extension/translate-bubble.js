(function() {
  let el = null;
  let outsideClickHandler = null;
  function removeExisting() {
    if (el) {
      el.remove();
      el = null;
    }
    if (outsideClickHandler) {
      document.removeEventListener("mousedown", outsideClickHandler, true);
      outsideClickHandler = null;
    }
  }
  function positionNear(rect) {
    el.style.left = `${window.scrollX + rect.left}px`;
    el.style.top = `${window.scrollY + rect.bottom + 6}px`;
  }
  function create(rect) {
    removeExisting();
    el = document.createElement("div");
    el.className = "cft-bubble";
    document.body.appendChild(el);
    positionNear(rect);
    outsideClickHandler = (e) => {
      if (el && !el.contains(e.target)) hide();
    };
    document.addEventListener("mousedown", outsideClickHandler, true);
    return el;
  }
  function hide() {
    removeExisting();
  }
  function showIdle(rect, onTranslateClick) {
    create(rect);
    el.innerHTML = "";
    el.classList.add("cft-bubble--idle");
    const btn = document.createElement("button");
    btn.className = "cft-bubble__trigger";
    btn.type = "button";
    btn.textContent = "🌐";
    btn.title = "Перевести";
    btn.addEventListener("click", onTranslateClick);
    el.appendChild(btn);
  }
  function showLoading() {
    if (!el) return;
    el.classList.remove("cft-bubble--idle", "cft-bubble--error", "cft-bubble--budget");
    el.innerHTML = "";
    const row = document.createElement("div");
    row.className = "cft-bubble__row";
    const spinner = document.createElement("div");
    spinner.className = "cft-bubble__spinner";
    const text = document.createElement("div");
    text.className = "cft-bubble__text";
    text.textContent = "Перевожу...";
    row.appendChild(spinner);
    row.appendChild(text);
    el.appendChild(row);
  }
  function showSuccess(translation) {
    if (!el) return;
    el.classList.remove("cft-bubble--idle", "cft-bubble--error", "cft-bubble--budget");
    el.innerHTML = "";
    const row = document.createElement("div");
    row.className = "cft-bubble__row";
    const text = document.createElement("div");
    text.className = "cft-bubble__text";
    text.textContent = translation;
    row.appendChild(text);
    el.appendChild(row);
    const actions = document.createElement("div");
    actions.className = "cft-bubble__row";
    actions.style.marginTop = "8px";
    const copyBtn = document.createElement("button");
    copyBtn.className = "cft-bubble__btn";
    copyBtn.type = "button";
    copyBtn.textContent = "Копировать";
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(translation);
        copyBtn.textContent = "Скопировано";
        setTimeout(() => {
          if (copyBtn.isConnected) copyBtn.textContent = "Копировать";
        }, 1200);
      } catch (_) {
        copyBtn.textContent = "Не вышло скопировать";
      }
    });
    const insertBtn = document.createElement("button");
    insertBtn.className = "cft-bubble__btn";
    insertBtn.type = "button";
    insertBtn.textContent = "Вставить";
    insertBtn.addEventListener("click", () => {
      const inserted = window.CftChatterfyApi.insertIntoCompose(translation, { replaceAll: true });
      insertBtn.textContent = inserted ? "Вставлено" : "Поле ввода не найдено";
      setTimeout(() => {
        if (insertBtn.isConnected) insertBtn.textContent = "Вставить";
      }, 1200);
    });
    const closeBtn = document.createElement("button");
    closeBtn.className = "cft-bubble__btn cft-bubble__btn--ghost";
    closeBtn.type = "button";
    closeBtn.textContent = "Закрыть";
    closeBtn.addEventListener("click", hide);
    actions.appendChild(copyBtn);
    actions.appendChild(insertBtn);
    actions.appendChild(closeBtn);
    el.appendChild(actions);
  }
  function showNetworkError(onRetry) {
    if (!el) return;
    el.classList.add("cft-bubble--error");
    el.classList.remove("cft-bubble--idle", "cft-bubble--budget");
    el.innerHTML = "";
    const text = document.createElement("div");
    text.className = "cft-bubble__text";
    text.textContent = "Не удалось перевести, попробуйте ещё раз";
    el.appendChild(text);
    const actions = document.createElement("div");
    actions.className = "cft-bubble__row";
    actions.style.marginTop = "8px";
    const retryBtn = document.createElement("button");
    retryBtn.className = "cft-bubble__btn";
    retryBtn.type = "button";
    retryBtn.textContent = "Повторить";
    retryBtn.addEventListener("click", onRetry);
    const closeBtn = document.createElement("button");
    closeBtn.className = "cft-bubble__btn cft-bubble__btn--ghost";
    closeBtn.type = "button";
    closeBtn.textContent = "Закрыть";
    closeBtn.addEventListener("click", hide);
    actions.appendChild(retryBtn);
    actions.appendChild(closeBtn);
    el.appendChild(actions);
  }
  function showBudgetExceeded(message) {
    if (!el) return;
    el.classList.add("cft-bubble--budget");
    el.classList.remove("cft-bubble--idle", "cft-bubble--error");
    el.innerHTML = "";
    const text = document.createElement("div");
    text.className = "cft-bubble__text";
    text.textContent = message || "Дневной лимит на перевод исчерпан";
    el.appendChild(text);
    const actions = document.createElement("div");
    actions.className = "cft-bubble__row";
    actions.style.marginTop = "8px";
    const closeBtn = document.createElement("button");
    closeBtn.className = "cft-bubble__btn cft-bubble__btn--ghost";
    closeBtn.type = "button";
    closeBtn.textContent = "Закрыть";
    closeBtn.addEventListener("click", hide);
    actions.appendChild(closeBtn);
    el.appendChild(actions);
  }
  window.CftTranslateBubble = {
    showIdle,
    showLoading,
    showSuccess,
    showNetworkError,
    showBudgetExceeded,
    hide
  };
})();
