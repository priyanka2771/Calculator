"use strict";

/* ---------- Safe expression evaluator (no eval) ---------- */

function tokenize(src) {
  const tokens = [];
  const re = /\s*(?:(\d+\.?\d*|\.\d+)|(sin|cos|tan|asin|acos|atan|ln|log|sqrt|cbrt|abs|Ans)|(π|e)|([+\-*/^%!()]))/gy;
  let m;
  let last = 0;
  while (last < src.length && (m = re.exec(src))) {
    last = re.lastIndex;
    if (m[1] !== undefined) tokens.push({ t: "num", v: parseFloat(m[1]) });
    else if (m[2]) tokens.push({ t: m[2] === "Ans" ? "ans" : "fn", v: m[2] });
    else if (m[3]) tokens.push({ t: "num", v: m[3] === "π" ? Math.PI : Math.E });
    else tokens.push({ t: "op", v: m[4] });
  }
  if (src.slice(last).trim() !== "") throw new Error("Bad input");
  return tokens;
}

function evaluate(src, { degrees, ans }) {
  const norm = src.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-");
  const tokens = tokenize(norm);
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (v) => peek() && peek().t === "op" && peek().v === v;
  const toRad = (x) => (degrees ? (x * Math.PI) / 180 : x);
  const fromRad = (x) => (degrees ? (x * 180) / Math.PI : x);

  const fns = {
    sin: (x) => {
      const r = Math.sin(toRad(x));
      return Math.abs(r) < 1e-15 ? 0 : r;
    },
    cos: (x) => {
      const r = Math.cos(toRad(x));
      return Math.abs(r) < 1e-15 ? 0 : r;
    },
    tan: (x) => Math.tan(toRad(x)),
    asin: (x) => fromRad(Math.asin(x)),
    acos: (x) => fromRad(Math.acos(x)),
    atan: (x) => fromRad(Math.atan(x)),
    ln: Math.log,
    log: Math.log10,
    sqrt: Math.sqrt,
    cbrt: Math.cbrt,
    abs: Math.abs,
  };

  function factorial(n) {
    if (n < 0 || !Number.isInteger(n) || n > 170) throw new Error("Math error");
    let r = 1;
    for (let k = 2; k <= n; k++) r *= k;
    return r;
  }

  // expr := term (('+'|'-') term)*
  function expr() {
    let v = term();
    while (isOp("+") || isOp("-")) {
      const op = tokens[i++].v;
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  }
  // term := unary (('*'|'/') unary | implicit-mult)*
  function term() {
    let v = unary();
    for (;;) {
      if (isOp("*") || isOp("/")) {
        const op = tokens[i++].v;
        const r = unary();
        if (op === "/" && r === 0) throw new Error("Divide by zero");
        v = op === "*" ? v * r : v / r;
      } else if (peek() && (peek().t !== "op" || peek().v === "(")) {
        v *= unary(); // implicit multiplication: 2π, 3(4+1)
      } else break;
    }
    return v;
  }
  function unary() {
    if (isOp("-")) { i++; return -unary(); }
    if (isOp("+")) { i++; return unary(); }
    return power();
  }
  // power := postfix ('^' unary)?   (right associative)
  function power() {
    const base = postfix();
    if (isOp("^")) { i++; return Math.pow(base, unary()); }
    return base;
  }
  function postfix() {
    let v = primary();
    while (isOp("!") || isOp("%")) {
      const op = tokens[i++].v;
      v = op === "!" ? factorial(v) : v / 100;
    }
    return v;
  }
  function primary() {
    const tok = tokens[i++];
    if (!tok) throw new Error("Incomplete");
    if (tok.t === "num") return tok.v;
    if (tok.t === "ans") return ans;
    if (tok.t === "fn") {
      if (!isOp("(")) throw new Error("Expected (");
      return fns[tok.v](primary());
    }
    if (tok.t === "op" && tok.v === "(") {
      const v = expr();
      if (isOp(")")) i++; // auto-close missing parenthesis at the end
      else if (i < tokens.length) throw new Error("Expected )");
      return v;
    }
    throw new Error("Unexpected token");
  }

  const result = expr();
  if (i < tokens.length) throw new Error("Unexpected token");
  if (!Number.isFinite(result)) throw new Error("Math error");
  return result;
}

function formatNumber(n) {
  if (Object.is(n, -0)) n = 0;
  const abs = Math.abs(n);
  if (abs !== 0 && (abs >= 1e15 || abs < 1e-9)) return n.toExponential(8).replace(/\.?0+e/, "e");
  return String(parseFloat(n.toPrecision(12)));
}

/* ---------- UI ---------- */

document.addEventListener("DOMContentLoaded", () => {
  const $ = (id) => document.getElementById(id);
  const calc = document.querySelector(".calculator");
  const exprEl = $("expression");
  const previewEl = $("preview");
  const memFlag = $("memory-flag");
  const historyEl = $("history");
  const historyList = $("history-list");
  const historyEmpty = $("history-empty");
  const toast = $("toast");

  const store = {
    get(k, d) {
      try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ }
    },
  };

  let expression = "";
  let justEvaluated = false;
  let ans = store.get("calc-ans", 0);
  let memory = store.get("calc-memory", 0);
  let history = store.get("calc-history", []);
  let degrees = store.get("calc-deg", true);
  let mode = store.get("calc-mode", "basic");
  let theme = store.get("calc-theme", matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");

  const OPERATORS = "+−×÷^";

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => toast.classList.remove("show"), 1400);
  }

  function tryEval(src) {
    return evaluate(src, { degrees, ans });
  }

  function replay(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function render() {
    exprEl.classList.remove("error");
    exprEl.textContent = expression || "0";
    exprEl.scrollLeft = exprEl.scrollWidth;
    previewEl.textContent = "";
    if (expression && !justEvaluated && /[+−×÷^%!(]/.test(expression)) {
      try { previewEl.textContent = "= " + formatNumber(tryEval(expression)); } catch { /* incomplete */ }
    }
    memFlag.hidden = memory === 0;
  }

  function append(v) {
    if (justEvaluated) {
      // continue from result when an operator is typed, otherwise start fresh
      expression = OPERATORS.includes(v) || v === "%" || v === "!" || v === "^2" ? "Ans" : "";
      justEvaluated = false;
    }
    const lastCh = expression.slice(-1);
    if (OPERATORS.includes(v)) {
      if (!expression && v !== "−") expression = "Ans";
      else if (OPERATORS.includes(lastCh) && !(v === "−" && lastCh !== "−")) expression = expression.slice(0, -1);
    }
    if (v === ".") {
      const lastNum = expression.split(/[^0-9.]/).pop();
      if (lastNum.includes(".")) return;
    }
    expression += v;
    render();
  }

  function equals() {
    if (!expression) return;
    try {
      const res = tryEval(expression);
      const text = formatNumber(res);
      pushHistory(expression, text);
      ans = parseFloat(text);
      store.set("calc-ans", ans);
      expression = text;
      justEvaluated = true;
      render();
      previewEl.textContent = "";
      replay(exprEl, "pop");
    } catch (e) {
      exprEl.classList.remove("error");
      void exprEl.offsetWidth; // restart shake animation
      exprEl.classList.add("error");
      previewEl.textContent = e.message;
    }
  }

  function currentValue() {
    try { return tryEval(expression || "0"); } catch { return null; }
  }

  function action(act) {
    switch (act) {
      case "ac": expression = ""; justEvaluated = false; render(); break;
      case "del":
        if (justEvaluated) { expression = ""; justEvaluated = false; }
        else expression = expression.replace(/(sin|cos|tan|asin|acos|atan|ln|log|sqrt|cbrt|abs|Ans)\($|Ans$|.$/u, "");
        render();
        break;
      case "eq": equals(); break;
      case "neg": {
        if (!expression) break;
        expression = expression.startsWith("−") ? expression.slice(1) : "−" + expression;
        justEvaluated = false;
        render();
        break;
      }
      case "mc": memory = 0; store.set("calc-memory", 0); render(); showToast("Memory cleared"); break;
      case "mr": if (memory !== 0) { append(formatNumber(memory).replace("-", "−")); } break;
      case "m+": case "m-": {
        const v = currentValue();
        if (v === null) { showToast("Nothing to store"); break; }
        memory += act === "m+" ? v : -v;
        store.set("calc-memory", memory);
        render();
        showToast("Memory: " + formatNumber(memory));
        break;
      }
      case "copy": {
        const text = previewEl.textContent.replace("= ", "") || exprEl.textContent;
        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
          .then(() => showToast("Copied " + text), () => showToast("Copy failed"));
        break;
      }
    }
  }

  /* history */
  function pushHistory(expr, result) {
    history.unshift({ expr, result });
    history = history.slice(0, 30);
    store.set("calc-history", history);
    renderHistory();
  }
  function renderHistory() {
    historyList.innerHTML = "";
    historyEmpty.style.display = history.length ? "none" : "block";
    history.forEach((h) => {
      const li = document.createElement("li");
      const a = document.createElement("div");
      a.className = "h-expr";
      a.textContent = h.expr + " =";
      const b = document.createElement("div");
      b.className = "h-res";
      b.textContent = h.result;
      li.append(a, b);
      li.title = "Click to use result · Shift+click to reuse expression";
      li.addEventListener("click", (e) => {
        expression = e.shiftKey ? h.expr : h.result;
        justEvaluated = false;
        render();
        historyEl.classList.remove("open");
      });
      historyList.appendChild(li);
    });
  }
  $("history-clear").addEventListener("click", () => {
    history = [];
    store.set("calc-history", history);
    renderHistory();
  });
  $("history-open").addEventListener("click", () => historyEl.classList.add("open"));
  $("history-close").addEventListener("click", () => historyEl.classList.remove("open"));

  /* modes / theme */
  function applyMode() {
    calc.classList.toggle("scientific", mode === "scientific");
    document.querySelectorAll(".seg").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  }
  document.querySelectorAll(".seg").forEach((b) =>
    b.addEventListener("click", () => { mode = b.dataset.mode; store.set("calc-mode", mode); applyMode(); })
  );
  const angleBtn = $("angle-toggle");
  function applyAngle() { angleBtn.textContent = degrees ? "DEG" : "RAD"; }
  angleBtn.addEventListener("click", () => { degrees = !degrees; store.set("calc-deg", degrees); applyAngle(); render(); });
  function applyTheme() { document.documentElement.dataset.theme = theme; }
  $("theme-toggle").addEventListener("click", () => {
    theme = theme === "dark" ? "light" : "dark";
    store.set("calc-theme", theme);
    applyTheme();
    replay($("theme-toggle"), "spin");
  });

  /* ripple effect */
  document.addEventListener("pointerdown", (e) => {
    const btn = e.target.closest(".key, .mem, .chip, .icon-btn, .seg");
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2;
    const dot = document.createElement("span");
    dot.className = "ripple";
    dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    btn.appendChild(dot);
    dot.addEventListener("animationend", () => dot.remove());
  });

  /* button clicks */
  document.querySelectorAll("[data-v]").forEach((b) => b.addEventListener("click", () => append(b.dataset.v)));
  document.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => action(b.dataset.act)));

  /* keyboard */
  const KEYMAP = { "*": "×", "/": "÷", "-": "−", x: "×", X: "×" };
  function flash(sel) {
    const el = document.querySelector(sel);
    if (!el) return;
    el.classList.add("pressed");
    setTimeout(() => el.classList.remove("pressed"), 120);
  }
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (/^[0-9]$/.test(k) || k === ".") { append(k); flash(`[data-v="${k}"]`); }
    else if (KEYMAP[k] || k === "+" || k === "%" || k === "^" || k === "(" || k === ")" || k === "!") {
      const v = KEYMAP[k] || k;
      append(v);
      flash(`[data-v="${v}"]`);
    } else if (k === "Enter" || k === "=") { e.preventDefault(); action("eq"); flash(".equal"); }
    else if (k === "Backspace") { action("del"); flash('[data-act="del"]'); }
    else if (k === "Escape" || k === "Delete") { action("ac"); flash('[data-act="ac"]'); }
    else if (k === "p") append("π");
  });

  applyTheme();
  applyMode();
  applyAngle();
  renderHistory();
  render();
});
