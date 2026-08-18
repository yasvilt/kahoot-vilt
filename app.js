/* ===========================================================
   Vilt Group Quiz App — Logic (vanilla JS, no dependencies)
   Persistence: localStorage. No backend.
   =========================================================== */

(function () {
  'use strict';

  // ---------------------------------------------------------
  // Constants / storage keys
  // ---------------------------------------------------------
  var LS_QUESTIONS = 'vg_quiz_questions';
  var LS_RESULTS = 'vg_quiz_results';
  var LS_ADMIN_PASS = 'vg_quiz_admin_pass';
  var LS_CODE_MAP = 'vg_quiz_code_map'; // code -> base64 payload (same device only)
  var DEFAULT_ADMIN_PASS = 'vilt2024';

  var OPTION_COLORS = ['red', 'blue', 'yellow', 'green'];
  var OPTION_LABELS = ['A', 'B', 'C', 'D'];
  var TYPE_OPTION_COUNT = { classic4: 4, classic2: 2, truefalse: 2, multi: 4 };
  var TYPE_LABELS = {
    classic4: 'Multiple choice (4)',
    classic2: 'Multiple choice (2)',
    truefalse: 'True/False',
    multi: 'Multiple select'
  };
  var TYPE_CODES = { classic4: 1, classic2: 2, truefalse: 3, multi: 4 };
  var TYPE_CODES_REVERSE = { 1: 'classic4', 2: 'classic2', 3: 'truefalse', 4: 'multi' };

  // ---------------------------------------------------------
  // Preloaded sample data (only if nothing exists yet)
  // ---------------------------------------------------------
  var SAMPLE_QUESTIONS = [
    {
      id: 'q1',
      text: 'What does "UX" mean in software development?',
      type: 'classic4',
      options: ['User Experience', 'Unified Xample', 'Universal Export', 'User Extension'],
      correct: 0,
      time: 20
    },
    {
      id: 'q2',
      text: 'Which of these is a programming language?',
      type: 'classic4',
      options: ['HTML', 'JavaScript', 'CSS', 'JSON'],
      correct: 1,
      time: 15
    },
    {
      id: 'q3',
      text: 'What does "API" stand for?',
      type: 'classic4',
      options: ['Application Programming Interface', 'Advanced Public Internet', 'App Process Index', 'Automated Program Instruction'],
      correct: 0,
      time: 20
    }
  ];

  // ---------------------------------------------------------
  // Question normalization (compatibility with old data)
  // ---------------------------------------------------------
  function normalizeQuestion(q) {
    if (!q.type) q.type = 'classic4';
    if (q.type === 'multi' && !Array.isArray(q.correct)) q.correct = [q.correct];
    return q;
  }
  function normalizeQuestions(list) {
    return (list || []).map(normalizeQuestion);
  }

  // ---------------------------------------------------------
  // Storage helpers
  // ---------------------------------------------------------
  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function saveJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }
  function getQuestions() {
    return normalizeQuestions(loadJSON(LS_QUESTIONS, null) || SAMPLE_QUESTIONS.slice());
  }
  function setQuestions(list) {
    saveJSON(LS_QUESTIONS, list);
  }
  function getResults() {
    return loadJSON(LS_RESULTS, []);
  }
  function setResults(list) {
    saveJSON(LS_RESULTS, list);
  }
  function getAdminPass() {
    return localStorage.getItem(LS_ADMIN_PASS) || DEFAULT_ADMIN_PASS;
  }
  function setAdminPass(pass) {
    localStorage.setItem(LS_ADMIN_PASS, pass);
  }

  // Ensure sample data exists on first run
  if (!localStorage.getItem(LS_QUESTIONS)) {
    setQuestions(SAMPLE_QUESTIONS);
  }

  // ---------------------------------------------------------
  // Compact question encoding (to shorten the link/code)
  // ---------------------------------------------------------
  function toCompactQuestion(q) {
    var compact = { i: q.id, t: q.text, y: TYPE_CODES[q.type] || 1, c: q.correct, s: q.time };
    if (q.type !== 'truefalse') compact.o = q.options;
    return compact;
  }
  function fromCompactQuestion(c) {
    var type = TYPE_CODES_REVERSE[c.y] || 'classic4';
    return {
      id: c.i,
      text: c.t,
      type: type,
      options: type === 'truefalse' ? ['True', 'False'] : c.o,
      correct: c.c,
      time: c.s
    };
  }

  // ---------------------------------------------------------
  // Base64 helpers (UTF-8 safe) to encode the quiz into the URL
  // ---------------------------------------------------------
  function encodeQuizPayload(questions) {
    var json = JSON.stringify(questions.map(toCompactQuestion));
    var utf8 = unescape(encodeURIComponent(json));
    return btoa(utf8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeQuizPayload(payload) {
    try {
      var b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      while (b64.length % 4) b64 += '=';
      var utf8 = atob(b64);
      var json = decodeURIComponent(escape(utf8));
      var parsed = JSON.parse(json);
      if (!Array.isArray(parsed)) return null;
      // Compatibility with old links generated before compact encoding.
      if (parsed.length && parsed[0] && typeof parsed[0].text !== 'undefined') {
        return parsed;
      }
      return parsed.map(fromCompactQuestion);
    } catch (e) {
      return null;
    }
  }
  function generateShortCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
  }

  // ---------------------------------------------------------
  // DOM references
  // ---------------------------------------------------------
  var $ = function (id) { return document.getElementById(id); };

  var views = {
    home: $('view-home'),
    adminLogin: $('view-admin-login'),
    admin: $('view-admin'),
    join: $('view-join'),
    play: $('view-play'),
    result: $('view-result')
  };

  function showView(name) {
    Object.keys(views).forEach(function (key) {
      views[key].classList.toggle('active-view', key === name);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------------------------------------------------------
  // In-memory state for the player's game session
  // ---------------------------------------------------------
  var session = {
    questions: [],
    quizLabel: '',
    playerName: '',
    currentIndex: 0,
    score: 0,
    answers: [], // {questionText, correct, timeTaken, chosenIndex}
    timer: null,
    timeLeft: 0,
    questionStartedAt: 0,
    answered: false,
    selectedMulti: []
  };

  // ---------------------------------------------------------
  // Initialization / URL routing
  // ---------------------------------------------------------
  $('footerYear').textContent = new Date().getFullYear();

  function init() {
    var params = new URLSearchParams(window.location.search);
    var payload = params.get('q') || params.get('quiz');
    var code = params.get('code');

    if (payload) {
      var decoded = decodeQuizPayload(payload);
      if (decoded && decoded.length) {
        startClientFlow(normalizeQuestions(decoded));
        return;
      }
    }
    if (code) {
      var map = loadJSON(LS_CODE_MAP, {});
      if (map[code]) {
        var decodedFromCode = decodeQuizPayload(map[code]);
        if (decodedFromCode && decodedFromCode.length) {
          startClientFlow(normalizeQuestions(decodedFromCode));
          return;
        }
      }
    }
    showView('home');
  }

  function startClientFlow(questions) {
    session.questions = questions;
    showView('join');
  }

  // ---------------------------------------------------------
  // HOME: join by code or link
  // ---------------------------------------------------------
  $('joinCodeForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var raw = $('joinCodeInput').value.trim();
    if (!raw) return;

    // If they pasted a full URL, navigate there directly.
    if (/^https?:\/\//i.test(raw)) {
      window.location.href = raw;
      return;
    }

    var map = loadJSON(LS_CODE_MAP, {});
    var code = raw.toUpperCase();
    if (map[code]) {
      var decoded = decodeQuizPayload(map[code]);
      if (decoded && decoded.length) {
        startClientFlow(normalizeQuestions(decoded));
        return;
      }
    }
    alert('We could not find that code on this device. Ask the admin for the full link.');
  });

  $('goAdminLink').addEventListener('click', function () {
    showView('adminLogin');
  });
  $('navAdminBtn').addEventListener('click', function () {
    showView(isAdminLoggedIn() ? 'admin' : 'adminLogin');
    if (isAdminLoggedIn()) renderAdmin();
  });
  $('navHomeBtn').addEventListener('click', function () {
    showView('home');
  });

  // ---------------------------------------------------------
  // ADMIN: login / logout
  // ---------------------------------------------------------
  var ADMIN_SESSION_KEY = 'vg_quiz_admin_session';
  function isAdminLoggedIn() {
    return sessionStorage.getItem(ADMIN_SESSION_KEY) === '1';
  }

  $('adminLoginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var pass = $('adminPasswordInput').value;
    if (pass === getAdminPass()) {
      sessionStorage.setItem(ADMIN_SESSION_KEY, '1');
      $('adminLoginError').classList.add('hidden');
      $('adminPasswordInput').value = '';
      renderAdmin();
      showView('admin');
    } else {
      $('adminLoginError').classList.remove('hidden');
    }
  });

  $('adminLogoutBtn').addEventListener('click', function () {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    showView('home');
  });

  // ---------------------------------------------------------
  // ADMIN: tabs
  // ---------------------------------------------------------
  document.querySelectorAll('.tab-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.tab-btn').forEach(function (b) { b.classList.remove('active'); });
      document.querySelectorAll('.tab-panel').forEach(function (p) { p.classList.remove('active'); });
      btn.classList.add('active');
      $('tab-' + btn.dataset.tab).classList.add('active');
      if (btn.dataset.tab === 'results') renderResults();
    });
  });

  // ---------------------------------------------------------
  // ADMIN: generate shareable link
  // ---------------------------------------------------------
  $('shareLinkBtn').addEventListener('click', function () {
    var questions = getQuestions();
    if (!questions.length) {
      alert('Add at least one question before generating the link.');
      return;
    }
    var payload = encodeQuizPayload(questions);
    var code = generateShortCode();
    var map = loadJSON(LS_CODE_MAP, {});
    map[code] = payload;
    saveJSON(LS_CODE_MAP, map);

    var url = window.location.origin + window.location.pathname + '?q=' + payload;
    $('shareCodeOutput').value = code;
    $('shareLinkOutput').value = url;
    $('shareLinkBox').classList.remove('hidden');
  });

  function copyInputValue(inputId, btn) {
    var input = $(inputId);
    input.select();
    input.setSelectionRange(0, 99999);
    navigator.clipboard && navigator.clipboard.writeText(input.value).catch(function () {});
    try { document.execCommand('copy'); } catch (e) {}
    var original = btn.textContent;
    btn.textContent = 'Copied ✓';
    setTimeout(function () { btn.textContent = original; }, 1500);
  }

  $('copyShareCodeBtn').addEventListener('click', function () {
    copyInputValue('shareCodeOutput', this);
  });

  $('copyShareLinkBtn').addEventListener('click', function () {
    copyInputValue('shareLinkOutput', this);
  });

  // ---------------------------------------------------------
  // ADMIN: question management
  // ---------------------------------------------------------
  var editingQuestionId = null;

  function renderAdmin() {
    renderQuestionList();
    renderResults();
  }

  function renderQuestionList() {
    var questions = getQuestions();
    var list = $('questionList');
    list.innerHTML = '';
    $('noQuestionsMsg').classList.toggle('hidden', questions.length > 0);

    questions.forEach(function (q, idx) {
      var li = document.createElement('li');
      li.className = 'question-item';
      var correctIndexes = Array.isArray(q.correct) ? q.correct : [q.correct];
      var correctLabel = correctIndexes.map(function (i) {
        return OPTION_LABELS[i] + ') ' + escapeHtml(q.options[i]);
      }).join(', ');
      li.innerHTML =
        '<div class="q-order">' +
          '<button type="button" data-move="up" data-idx="' + idx + '" ' + (idx === 0 ? 'disabled' : '') + '>▲</button>' +
          '<button type="button" data-move="down" data-idx="' + idx + '" ' + (idx === questions.length - 1 ? 'disabled' : '') + '>▼</button>' +
        '</div>' +
        '<div class="q-body">' +
          '<p class="q-text">' + (idx + 1) + '. ' + escapeHtml(q.text) + '</p>' +
          '<p class="q-meta">' + TYPE_LABELS[q.type] + ' &middot; Correct: ' + correctLabel + ' &middot; ' + q.time + 's</p>' +
        '</div>' +
        '<div class="q-actions">' +
          '<button type="button" class="icon-btn" data-edit="' + q.id + '">Edit</button>' +
          '<button type="button" class="icon-btn danger" data-delete="' + q.id + '">Delete</button>' +
        '</div>';
      list.appendChild(li);
    });
  }

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  $('questionList').addEventListener('click', function (e) {
    var target = e.target;
    if (target.dataset.edit) {
      openQuestionModal(target.dataset.edit);
    } else if (target.dataset.delete) {
      if (confirm('Delete this question?')) {
        var questions = getQuestions().filter(function (q) { return q.id !== target.dataset.delete; });
        setQuestions(questions);
        renderQuestionList();
      }
    } else if (target.dataset.move) {
      var idx = parseInt(target.dataset.idx, 10);
      var dir = target.dataset.move === 'up' ? -1 : 1;
      var questions = getQuestions();
      var newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= questions.length) return;
      var tmp = questions[idx];
      questions[idx] = questions[newIdx];
      questions[newIdx] = tmp;
      setQuestions(questions);
      renderQuestionList();
    }
  });

  $('addQuestionBtn').addEventListener('click', function () {
    openQuestionModal(null);
  });

  function updateOptionFieldsForType(type) {
    var count = TYPE_OPTION_COUNT[type];
    for (var i = 0; i < 4; i++) {
      var field = document.querySelector('.option-field[data-opt-idx="' + i + '"]');
      var input = $('qOption' + i);
      if (i < count) {
        field.classList.remove('hidden');
        input.required = true;
      } else {
        field.classList.add('hidden');
        input.required = false;
        input.value = '';
      }
      if (type === 'truefalse') {
        input.value = i === 0 ? 'True' : 'False';
        input.readOnly = true;
        input.classList.add('readonly-input');
      } else {
        input.readOnly = false;
        input.classList.remove('readonly-input');
      }
    }
  }

  function renderCorrectControls(type) {
    var count = TYPE_OPTION_COUNT[type];
    for (var i = 0; i < 4; i++) {
      var container = $('qCorrectControl' + i);
      container.innerHTML = '';
      if (i >= count) continue;
      if (type === 'multi') {
        container.innerHTML = '<label class="radio-label"><input type="checkbox" name="qCorrectMulti" value="' + i + '"> Correct</label>';
      } else {
        container.innerHTML = '<label class="radio-label"><input type="radio" name="qCorrect" value="' + i + '"> Correct</label>';
      }
    }
  }

  $('qTypeInput').addEventListener('change', function () {
    updateOptionFieldsForType(this.value);
    renderCorrectControls(this.value);
  });

  function openQuestionModal(questionId) {
    editingQuestionId = questionId;
    var modal = $('questionModal');
    var form = $('questionForm');
    form.reset();

    if (questionId) {
      var q = getQuestions().find(function (item) { return item.id === questionId; });
      $('questionModalTitle').textContent = 'Edit question';
      $('qTextInput').value = q.text;
      $('qTypeInput').value = q.type;
      updateOptionFieldsForType(q.type);
      renderCorrectControls(q.type);
      q.options.forEach(function (opt, idx) { $('qOption' + idx).value = opt; });
      $('qTimeInput').value = q.time;
      var correctIndexes = Array.isArray(q.correct) ? q.correct : [q.correct];
      correctIndexes.forEach(function (idx) {
        var name = q.type === 'multi' ? 'qCorrectMulti' : 'qCorrect';
        var control = form.querySelector('input[name="' + name + '"][value="' + idx + '"]');
        if (control) control.checked = true;
      });
    } else {
      $('questionModalTitle').textContent = 'New question';
      $('qTypeInput').value = 'classic4';
      updateOptionFieldsForType('classic4');
      renderCorrectControls('classic4');
      $('qTimeInput').value = 20;
    }
    modal.classList.remove('hidden');
  }

  $('cancelQuestionBtn').addEventListener('click', function () {
    $('questionModal').classList.add('hidden');
  });

  $('questionForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var type = $('qTypeInput').value;
    var count = TYPE_OPTION_COUNT[type];
    var options = [];
    for (var i = 0; i < count; i++) {
      options.push(type === 'truefalse' ? (i === 0 ? 'True' : 'False') : $('qOption' + i).value.trim());
    }

    var correct;
    if (type === 'multi') {
      var checked = Array.prototype.slice.call(document.querySelectorAll('input[name="qCorrectMulti"]:checked'));
      if (!checked.length) {
        alert('Select at least one correct option.');
        return;
      }
      correct = checked.map(function (c) { return parseInt(c.value, 10); }).sort(function (a, b) { return a - b; });
    } else {
      var correctRadio = document.querySelector('input[name="qCorrect"]:checked');
      if (!correctRadio) {
        alert('Select which option is correct.');
        return;
      }
      correct = parseInt(correctRadio.value, 10);
    }

    var newQuestion = {
      id: editingQuestionId || ('q' + Date.now() + Math.floor(Math.random() * 1000)),
      text: $('qTextInput').value.trim(),
      type: type,
      options: options,
      correct: correct,
      time: parseInt($('qTimeInput').value, 10) || 20
    };

    var questions = getQuestions();
    if (editingQuestionId) {
      questions = questions.map(function (q) { return q.id === editingQuestionId ? newQuestion : q; });
    } else {
      questions.push(newQuestion);
    }
    setQuestions(questions);
    $('questionModal').classList.add('hidden');
    renderQuestionList();
  });

  // ---------------------------------------------------------
  // ADMIN: results
  // ---------------------------------------------------------
  function renderResults() {
    var results = getResults();
    var tbody = $('resultsTableBody');
    tbody.innerHTML = '';
    $('noResultsMsg').classList.toggle('hidden', results.length > 0);

    results.slice().reverse().forEach(function (r) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' + escapeHtml(r.name) + '</td>' +
        '<td>' + r.score + '</td>' +
        '<td>' + r.correctCount + '/' + r.totalQuestions + '</td>' +
        '<td>' + r.totalTime.toFixed(1) + 's</td>' +
        '<td>' + new Date(r.date).toLocaleString() + '</td>';
      tbody.appendChild(tr);
    });
  }

  $('clearResultsBtn').addEventListener('click', function () {
    if (confirm('Delete all results saved on this device?')) {
      setResults([]);
      renderResults();
    }
  });

  $('exportCsvBtn').addEventListener('click', function () {
    var results = getResults();
    if (!results.length) {
      alert('No results to export.');
      return;
    }
    var rows = [['Name', 'Score', 'Correct', 'Total questions', 'Total time (s)', 'Date']];
    results.forEach(function (r) {
      rows.push([r.name, r.score, r.correctCount, r.totalQuestions, r.totalTime.toFixed(1), new Date(r.date).toLocaleString()]);
    });
    var csv = rows.map(function (row) {
      return row.map(function (cell) {
        var val = String(cell).replace(/"/g, '""');
        return '"' + val + '"';
      }).join(',');
    }).join('\n');

    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'vilt_quiz_results.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  });

  // ---------------------------------------------------------
  // ADMIN: change password
  // ---------------------------------------------------------
  $('changePasswordForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var newPass = $('newPasswordInput').value.trim();
    if (!newPass) return;
    setAdminPass(newPass);
    $('newPasswordInput').value = '';
    $('passwordChangedMsg').classList.remove('hidden');
    setTimeout(function () { $('passwordChangedMsg').classList.add('hidden'); }, 2500);
  });

  // ---------------------------------------------------------
  // CLIENT: name entry
  // ---------------------------------------------------------
  $('nameForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('playerNameInput').value.trim();
    if (!name) return;
    session.playerName = name;
    session.currentIndex = 0;
    session.score = 0;
    session.answers = [];
    showView('play');
    renderQuestion();
  });

  // ---------------------------------------------------------
  // CLIENT: gameplay — render question and timer
  // ---------------------------------------------------------
  function renderQuestion() {
    var q = session.questions[session.currentIndex];
    if (!q) {
      finishQuiz();
      return;
    }

    session.answered = false;
    session.selectedMulti = [];
    session.timeLeft = q.time;
    session.questionStartedAt = Date.now();

    $('progressLabel').textContent = 'Question ' + (session.currentIndex + 1) + ' / ' + session.questions.length;
    $('progressBarFill').style.width = ((session.currentIndex) / session.questions.length * 100) + '%';
    $('playQuestionText').textContent = q.text;

    var buttons = document.querySelectorAll('#answerGrid .answer-btn');
    buttons.forEach(function (btn, idx) {
      btn.disabled = false;
      btn.classList.remove('correct-answer', 'wrong-answer', 'selected');
      btn.classList.remove('opt-red', 'opt-blue', 'opt-yellow', 'opt-green', 'opt-truefalse-true', 'opt-truefalse-false');
      if (idx < q.options.length) {
        btn.classList.remove('hidden');
        $('playOption' + idx).textContent = q.options[idx];
        if (q.type === 'truefalse') {
          btn.classList.add(idx === 0 ? 'opt-truefalse-true' : 'opt-truefalse-false');
        } else {
          btn.classList.add('opt-' + OPTION_COLORS[idx]);
        }
      } else {
        btn.classList.add('hidden');
      }
    });

    var confirmBtn = $('confirmMultiBtn');
    confirmBtn.classList.toggle('hidden', q.type !== 'multi');
    confirmBtn.disabled = true;

    $('timerValue').textContent = session.timeLeft;
    var circle = $('timerCircle');
    circle.classList.remove('warning', 'danger');

    clearInterval(session.timer);
    session.timer = setInterval(function () {
      session.timeLeft -= 1;
      $('timerValue').textContent = Math.max(session.timeLeft, 0);
      if (session.timeLeft <= 5) circle.classList.add('warning');
      if (session.timeLeft <= 2) circle.classList.add('danger');
      if (session.timeLeft <= 0) {
        clearInterval(session.timer);
        if (q.type === 'multi') {
          // When time runs out, submit whatever was selected so far
          // (only counts as "no answer" if nothing was touched at all).
          handleAnswer(session.selectedMulti.slice(), session.selectedMulti.length === 0);
        } else {
          handleAnswer(null, true);
        }
      }
    }, 1000);
  }

  document.querySelectorAll('#answerGrid .answer-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (session.answered) return;
      var q = session.questions[session.currentIndex];
      var idx = parseInt(btn.dataset.idx, 10);
      if (q.type === 'multi') {
        toggleMultiSelection(idx, btn);
      } else {
        handleAnswer(idx, false);
      }
    });
  });

  function toggleMultiSelection(idx, btn) {
    var pos = session.selectedMulti.indexOf(idx);
    if (pos === -1) {
      session.selectedMulti.push(idx);
      btn.classList.add('selected');
    } else {
      session.selectedMulti.splice(pos, 1);
      btn.classList.remove('selected');
    }
    $('confirmMultiBtn').disabled = session.selectedMulti.length === 0;
  }

  $('confirmMultiBtn').addEventListener('click', function () {
    if (session.answered) return;
    handleAnswer(session.selectedMulti.slice(), false);
  });

  function arraysEqualAsSets(a, b) {
    if (a.length !== b.length) return false;
    var as = a.slice().sort(function (x, y) { return x - y; });
    var bs = b.slice().sort(function (x, y) { return x - y; });
    for (var i = 0; i < as.length; i++) {
      if (as[i] !== bs[i]) return false;
    }
    return true;
  }

  function handleAnswer(chosenIndex, isTimeout) {
    if (session.answered) return;
    session.answered = true;
    clearInterval(session.timer);

    var q = session.questions[session.currentIndex];
    var timeTaken = Math.min((Date.now() - session.questionStartedAt) / 1000, q.time);
    var isMulti = q.type === 'multi';
    var chosenList = isMulti ? chosenIndex : (chosenIndex === null ? [] : [chosenIndex]);
    var isCorrect = !isTimeout && (isMulti ? arraysEqualAsSets(chosenIndex, q.correct) : chosenIndex === q.correct);

    var buttons = document.querySelectorAll('#answerGrid .answer-btn');
    buttons.forEach(function (btn) {
      btn.disabled = true;
      var idx = parseInt(btn.dataset.idx, 10);
      var isCorrectOpt = isMulti ? q.correct.indexOf(idx) !== -1 : idx === q.correct;
      var wasChosen = chosenList.indexOf(idx) !== -1;
      btn.classList.remove('selected');
      if (isCorrectOpt) btn.classList.add('correct-answer');
      else if (wasChosen) btn.classList.add('wrong-answer');
    });
    $('confirmMultiBtn').disabled = true;

    var points = 0;
    if (isCorrect) {
      // Base score + speed bonus
      var speedBonus = Math.max(0, q.time - timeTaken) / q.time;
      points = Math.round(500 + speedBonus * 500);
    }
    session.score += points;

    var chosenText = isTimeout || !chosenList.length
      ? '(no answer)'
      : chosenList.map(function (i) { return q.options[i]; }).join(', ');
    var correctText = isMulti
      ? q.correct.map(function (i) { return q.options[i]; }).join(', ')
      : q.options[q.correct];

    session.answers.push({
      questionText: q.text,
      correct: isCorrect,
      chosenText: chosenText,
      correctText: correctText,
      timeTaken: timeTaken
    });

    showFeedback(isTimeout ? 'timeout' : (isCorrect ? 'correct' : 'wrong'), points);

    setTimeout(function () {
      hideFeedback();
      session.currentIndex += 1;
      renderQuestion();
    }, 1600);
  }

  function showFeedback(type, points) {
    var overlay = $('feedbackOverlay');
    var box = $('feedbackBox');
    box.className = 'feedback-box';
    var icon = '';
    var text = '';
    if (type === 'correct') {
      box.classList.add('is-correct');
      icon = '✔';
      text = 'Correct! +' + points + ' pts';
    } else if (type === 'wrong') {
      box.classList.add('is-wrong');
      icon = '✘';
      text = 'Incorrect';
    } else {
      box.classList.add('is-timeout');
      icon = '⏱';
      text = 'Time\'s up!';
    }
    $('feedbackIcon').textContent = icon;
    $('feedbackText').textContent = text;
    overlay.classList.remove('hidden');
  }
  function hideFeedback() {
    $('feedbackOverlay').classList.add('hidden');
  }

  // ---------------------------------------------------------
  // CLIENT: end of quiz — save and show result
  // ---------------------------------------------------------
  function finishQuiz() {
    $('progressBarFill').style.width = '100%';
    var correctCount = session.answers.filter(function (a) { return a.correct; }).length;
    var totalTime = session.answers.reduce(function (sum, a) { return sum + a.timeTaken; }, 0);

    var result = {
      name: session.playerName,
      score: session.score,
      correctCount: correctCount,
      totalQuestions: session.questions.length,
      totalTime: totalTime,
      date: Date.now()
    };
    var results = getResults();
    results.push(result);
    setResults(results);

    $('resultGreeting').textContent = 'Great job, ' + session.playerName + '.';
    $('finalScore').textContent = session.score;
    $('resultSummaryLine').textContent = correctCount + ' of ' + session.questions.length + ' correct answers · ' + totalTime.toFixed(1) + 's total';

    var list = $('answerSummaryList');
    list.innerHTML = '';
    session.answers.forEach(function (a, idx) {
      var li = document.createElement('li');
      li.className = a.correct ? 'is-correct' : 'is-wrong';
      li.innerHTML =
        '<span>' + (idx + 1) + '. ' + escapeHtml(a.questionText) + '</span>' +
        '<strong>' + (a.correct ? '✔' : '✘') + '</strong>';
      list.appendChild(li);
    });

    showView('result');
  }

  $('backHomeBtn').addEventListener('click', function () {
    window.location.href = window.location.origin + window.location.pathname;
  });

  // ---------------------------------------------------------
  // Startup
  // ---------------------------------------------------------
  init();
})();
