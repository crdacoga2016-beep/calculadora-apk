/* =========================================================
 C a*lculadora con doble cero (00) + Historial
 ========================================================= */
(function () {
    'use strict';

    /* ---------------- Referencias DOM ---------------- */
    const displayEl    = document.getElementById('display');
    const expressionEl = document.getElementById('expression');
    const buttonsEl    = document.getElementById('buttons');

    const historyBtn       = document.getElementById('historyBtn');
    const historyPanel     = document.getElementById('historyPanel');
    const historyListEl    = document.getElementById('historyList');
    const clearHistoryBtn  = document.getElementById('clearHistory');
    const closeHistoryBtn  = document.getElementById('closeHistory');

    /* ---------------- Estado ---------------- */
    let expression     = '';     // expresión actual
    let lastExpression = '';     // expresión que produjo el último resultado
    let justEvaluated  = false;  // se acaba de pulsar "="

    const MAX_LEN = 60;
    const OPERATORS = '+-−×÷';

    /* ---------------- Historial ---------------- */
    const HISTORY_KEY = 'calc_history_v1';
    const HISTORY_MAX = 50;
    let history = [];

    function loadHistory() {
        try {
            const raw = localStorage.getItem(HISTORY_KEY);
            history = raw ? JSON.parse(raw) : [];
            if (!Array.isArray(history)) history = [];
        } catch (e) {
            history = [];
        }
    }

    function saveHistory() {
        try {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
        } catch (e) { /* ignorar */ }
    }

    function renderHistory() {
        historyListEl.innerHTML = '';

        if (history.length === 0) {
            const p = document.createElement('p');
            p.className = 'history-empty';
            p.textContent = 'Sin operaciones todavía';
            historyListEl.appendChild(p);
            return;
        }

        history.forEach(function (item, idx) {
            const row = document.createElement('div');
            row.className = 'history-item';
            row.dataset.index = String(idx);

            const e = document.createElement('div');
            e.className = 'history-expr';
            e.textContent = item.expr + ' =';

            const r = document.createElement('div');
            r.className = 'history-result';
            r.textContent = item.result;

            row.appendChild(e);
            row.appendChild(r);
            historyListEl.appendChild(row);
        });
    }

    function addToHistory(expr, result) {
        if (!expr || !result) return;
        if (history.length &&
            history[0].expr === expr &&
            history[0].result === result) return;   // no duplicar consecutivos

            history.unshift({ expr: expr, result: result });
        if (history.length > HISTORY_MAX) history.length = HISTORY_MAX;
        saveHistory();
        renderHistory();
    }

    function openHistory() {
        renderHistory();
        historyPanel.classList.add('open');
        historyPanel.setAttribute('aria-hidden', 'false');
    }

    function closeHistory() {
        historyPanel.classList.remove('open');
        historyPanel.setAttribute('aria-hidden', 'true');
    }

    /* =========================================================
     *  1. FORMATEO (separador de miles)
     *  ========================================================= */

    function groupDigits(numStr) {
        const parts = String(numStr).split('.');
        let intPart = parts[0];
        let sign = '';
        if (intPart.charAt(0) === '-') {
            sign = '-';
            intPart = intPart.slice(1);
        }
        intPart = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        let out = sign + intPart;
        if (parts.length > 1) out += '.' + parts[1];
        return out;
    }

    function formatExpression(expr) {
        if (!expr) return '';
        return expr.replace(/\d+(?:\.\d*)?/g, function (m) {
            return groupDigits(m);
        });
    }

    function formatResult(num) {
        if (!isFinite(num)) return 'Error';
        if (Number.isInteger(num) && Math.abs(num) < 1e15) return String(num);

        const r = parseFloat(num.toPrecision(12));
        if (r === 0) return '0';
        if (Math.abs(r) >= 1e15 || Math.abs(r) < 1e-9) {
            return r.toExponential(6).replace(/\.?0+e/, 'e');
        }
        return String(r);
    }

    /* =========================================================
     *  2. MOTOR DE CÁLCULO
     *  ========================================================= */

    function normalize(expr) {
        return expr
        .replace(/×/g, '*')
        .replace(/÷/g, '/')
        .replace(/[−–—]/g, '-');
    }

    function tokenize(str) {
        const tokens = [];
        let i = 0;

        while (i < str.length) {
            const ch = str.charAt(i);

            if (ch === ' ') { i++; continue; }

            if ((ch >= '0' && ch <= '9') || ch === '.') {
                let numStr = '';
                while (i < str.length) {
                    const c = str.charAt(i);
                    if ((c >= '0' && c <= '9') || c === '.') {
                        numStr += c;
                        i++;
                    } else break;
                }

                const e = str.charAt(i);
                if (e === 'e' || e === 'E') {
                    let j = i + 1;
                    let expPart = 'e';
                    const s1 = str.charAt(j);
                    if (s1 === '+' || s1 === '-') { expPart += s1; j++; }
                    let digits = '';
                    while (j < str.length && str.charAt(j) >= '0' && str.charAt(j) <= '9') {
                        digits += str.charAt(j);
                        j++;
                    }
                    if (digits !== '') {
                        numStr += expPart + digits;
                        i = j;
                    }
                }

                if (numStr === '.' || numStr.split('.').length > 2) {
                    throw new Error('Número inválido');
                }

                tokens.push({ type: 'num', value: parseFloat(numStr) });
                continue;
            }

            if ('+-*/()'.indexOf(ch) !== -1) {
                tokens.push({ type: ch });
                i++;
                continue;
            }

            throw new Error('Carácter inválido');
        }

        return tokens;
    }

    function evaluate(expr) {
        let s = normalize(expr).replace(/\s+/g, '');
        s = s.replace(/[+\-*/]+$/, '');
        if (s === '') throw new Error('Expresión vacía');

        const open  = (s.match(/\(/g) || []).length;
        const close = (s.match(/\)/g) || []).length;
        if (close > open) throw new Error('Paréntesis desbalanceados');
        for (let k = close; k < open; k++) s += ')';

        const tokens = tokenize(s);
        let pos = 0;

        const peek    = () => tokens[pos];
        const advance = () => tokens[pos++];

        function parseExpression() {
            let value = parseTerm();
            while (peek() && (peek().type === '+' || peek().type === '-')) {
                const op = advance().type;
                const right = parseTerm();
                value = (op === '+') ? value + right : value - right;
            }
            return value;
        }

        function parseTerm() {
            let value = parseUnary();
            while (peek()) {
                const t = peek().type;

                if (t === '*' || t === '/') {
                    advance();
                    const right = parseUnary();
                    if (t === '/') {
                        if (right === 0) throw new Error('División por cero');
                        value = value / right;
                    } else {
                        value = value * right;
                    }
                } else if (t === 'num' || t === '(') {
                    value = value * parseUnary();
                } else {
                    break;
                }
            }
            return value;
        }

        function parseUnary() {
            const t = peek();
            if (t && (t.type === '-' || t.type === '+')) {
                advance();
                const v = parseUnary();
                return (t.type === '-') ? -v : v;
            }
            return parsePrimary();
        }

        function parsePrimary() {
            const t = peek();
            if (!t) throw new Error('Expresión incompleta');

            if (t.type === 'num') {
                advance();
                return t.value;
            }

            if (t.type === '(') {
                advance();
                const v = parseExpression();
                const c = peek();
                if (!c || c.type !== ')') throw new Error('Falta paréntesis de cierre');
                advance();
                return v;
            }

            throw new Error('Expresión inválida');
        }

        const result = parseExpression();
        if (pos < tokens.length) throw new Error('Expresión inválida');
        return result;
    }

    function computeResult(expr) {
        try {
            const value = evaluate(expr);
            if (!isFinite(value)) return null;
            return formatResult(value);
        } catch (err) {
            return null;
        }
    }

    /* =========================================================
     *  3. PINTAR LA PANTALLA
     *  ========================================================= */

    function updateDisplay() {
        displayEl.textContent = (expression === '') ? '0' : formatExpression(expression);
        displayEl.scrollLeft = displayEl.scrollWidth;

        if (justEvaluated) {
            expressionEl.textContent = lastExpression ? lastExpression + ' =' : '';
        } else if (expression === '') {
            expressionEl.textContent = '';
        } else {
            const hasOperator =
            /[+×÷()]/.test(expression) ||
            expression.slice(1).indexOf('−') !== -1;

            if (hasOperator) {
                const res = computeResult(expression);
                const formatted = formatExpression(expression);
                expressionEl.textContent =
                (res !== null && res !== formatted) ? '= ' + groupDigits(res) : '';
            } else {
                expressionEl.textContent = '';
            }
        }

        expressionEl.scrollLeft = expressionEl.scrollWidth;
    }

    /* =========================================================
     *  4. ACCIONES
     *  ========================================================= */

    function currentNumber() {
        const m = expression.match(/(\d+\.?\d*|\.\d*)$/);
        return m ? m[0] : '';
    }

    function inputDigit(value) {
        if (justEvaluated) {
            expression = '';
            lastExpression = '';
            justEvaluated = false;
        }

        const cur = currentNumber();

        if (value === '.') {
            if (cur.indexOf('.') !== -1) return;
            if (cur === '') {
                if (expression.length >= MAX_LEN) return;
                expression += '0.';
            } else {
                if (expression.length >= MAX_LEN) return;
                expression += '.';
            }
            updateDisplay();
            return;
        }

        if (value === '00') {
            if (cur === '') {
                if (expression.length >= MAX_LEN) return;
                expression += '0';
            } else if (cur === '0') {
                /* nada: evita 000 */
            } else {
                if (expression.length + 2 > MAX_LEN) return;
                expression += '00';
            }
            updateDisplay();
            return;
        }

        if (expression.length >= MAX_LEN) return;

        if (cur === '0') {
            expression = expression.slice(0, -1) + value;
        } else {
            expression += value;
        }

        updateDisplay();
    }

    function inputOperator(op) {
        if (justEvaluated) {
            justEvaluated = false;
            lastExpression = '';
        }

        if (expression === '') {
            if (op === '−') {
                expression = '−';
                updateDisplay();
            }
            return;
        }

        if (expression.length >= MAX_LEN) return;

        const last = expression.slice(-1);

        if (OPERATORS.indexOf(last) !== -1) {
            const prev = expression.charAt(expression.length - 2);
            if (op !== '−' && (prev === '' || prev === '(')) return;
            expression = expression.slice(0, -1) + op;
            updateDisplay();
            return;
        }

        if (last === '(') {
            if (op === '−') {
                expression += op;
                updateDisplay();
            }
            return;
        }

        expression += op;
        updateDisplay();
    }

    function inputParen() {
        if (justEvaluated) {
            expression = '';
            lastExpression = '';
            justEvaluated = false;
        }

        if (expression.length >= MAX_LEN) return;

        const open  = (expression.match(/\(/g) || []).length;
        const close = (expression.match(/\)/g) || []).length;
        const last  = expression.slice(-1);
        const afterValue = /[\d).]/.test(last);

        if (open > close && afterValue) {
            expression += ')';
        } else if (afterValue) {
            expression += '×(';
        } else {
            expression += '(';
        }

        updateDisplay();
    }

    function backspace() {
        if (justEvaluated) {
            clearAll();
            return;
        }
        if (expression === '') return;
        expression = expression.slice(0, -1);
        updateDisplay();
    }

    function clearAll() {
        expression = '';
        lastExpression = '';
        justEvaluated = false;
        displayEl.classList.remove('shake');
        updateDisplay();
    }

    function equals() {
        if (justEvaluated || expression === '') return;

        const res = computeResult(expression);

        if (res === null) {
            expressionEl.textContent = 'Error';
            expressionEl.scrollLeft = expressionEl.scrollWidth;
            displayEl.classList.add('shake');
            setTimeout(function () {
                displayEl.classList.remove('shake');
            }, 300);
            return;
        }

        lastExpression = formatExpression(expression);
        addToHistory(lastExpression, res);

        expression = res;
        justEvaluated = true;
        updateDisplay();
    }

    /* =========================================================
     *  5. EVENTOS
     *  ========================================================= */

    function vibrate() {
        if (navigator.vibrate) {
            try { navigator.vibrate(12); } catch (e) { /* ignorar */ }
        }
    }

    function handleButton(btn) {
        vibrate();

        const action = btn.dataset.action;
        const value  = btn.dataset.value;

        if (action === 'clear')  { clearAll();  return; }
        if (action === 'back')   { backspace(); return; }
        if (action === 'paren')  { inputParen(); return; }
        if (action === 'equals') { equals();    return; }

        if (value !== undefined) {
            if (OPERATORS.indexOf(value) !== -1) inputOperator(value);
            else inputDigit(value);
        }
    }

    /* ---- Teclado principal ---- */
    buttonsEl.addEventListener('click', function (e) {
        const btn = e.target.closest('button');
        if (!btn) return;
        handleButton(btn);
    });

    /* ---- Botón de historial ---- */
    historyBtn.addEventListener('click', function () {
        vibrate();
        openHistory();
    });

    closeHistoryBtn.addEventListener('click', function () {
        vibrate();
        closeHistory();
    });

    clearHistoryBtn.addEventListener('click', function () {
        vibrate();
        history = [];
        saveHistory();
        renderHistory();
    });

    /* ---- Tocar una operación del historial ---- */
    historyListEl.addEventListener('click', function (e) {
        const row = e.target.closest('.history-item');
        if (!row) return;

        const idx = parseInt(row.dataset.index, 10);
        const entry = history[idx];
        if (!entry) return;

        vibrate();

        expression = String(entry.result);
        lastExpression = '';
        justEvaluated = false;

        closeHistory();
        updateDisplay();
    });

    /* ---- Teclado físico ---- */
    document.addEventListener('keydown', function (e) {
        const k = e.key;

        if (k >= '0' && k <= '9') { inputDigit(k); e.preventDefault(); }
        else if (k === '.' || k === ',') { inputDigit('.'); e.preventDefault(); }
        else if (k === '+') { inputOperator('+'); e.preventDefault(); }
        else if (k === '-') { inputOperator('−'); e.preventDefault(); }
        else if (k === '*' || k === 'x' || k === 'X') { inputOperator('×'); e.preventDefault(); }
        else if (k === '/') { inputOperator('÷'); e.preventDefault(); }
        else if (k === '(' || k === ')') { inputParen(); e.preventDefault(); }
        else if (k === 'Enter' || k === '=') { equals(); e.preventDefault(); }
        else if (k === 'Backspace') { backspace(); e.preventDefault(); }
        else if (k === 'Escape' || k === 'Delete') { clearAll(); e.preventDefault(); }
    });

    /* ---- Escape también cierra historial ---- */
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && historyPanel.classList.contains('open')) {
            closeHistory();
        }
    });

    /* ---- Arranque ---- */
    loadHistory();
    renderHistory();
    updateDisplay();

})();
