const messageList = document.getElementById('messages');
const composer = document.getElementById('composer');
const input = document.getElementById('messageInput');
const timerDisplay = document.getElementById('timerDisplay');
const focusMeta = document.getElementById('focusMeta');
const startTimerBtn = document.getElementById('startTimerBtn');
const microStepBtn = document.getElementById('microStepBtn');
const todoList = document.getElementById('todoList');
const awardModal = document.getElementById('awardModal');
const awardTitle = document.getElementById('awardTitle');
const awardMessage = document.getElementById('awardMessage');
const closeAwardBtn = document.getElementById('closeAwardBtn');
const statusPill = document.getElementById('statusPill');
const conversationList = document.getElementById('conversationList');
const newConversationBtn = document.getElementById('newConversationBtn');

let timerId = null;
let timerSeconds = 25 * 60;
let timerTaskName = '专注时段';
let ambientAudioCtx = null;
let ambientGain = null;
let visibilityTimer = null;
let focusModeEnabled = false;
let conversations = [];
let currentConversationId = null;
const STORAGE_KEY = 'study_agent_conversations';
const CURRENT_CONVERSATION_KEY = 'study_agent_current_conversation';
const DEFAULT_BOT_ID = 'YOUR_BOT_ID';

function addMessage(role, text) {
  const bubble = document.createElement('div');
  bubble.className = `message ${role}`;
  bubble.textContent = text;
  messageList.appendChild(bubble);
  messageList.scrollTop = messageList.scrollHeight;
}

function setStatus(text) {
  statusPill.textContent = text;
}

function updateTimerDisplay() {
  const minutes = String(Math.floor(timerSeconds / 60)).padStart(2, '0');
  const seconds = String(timerSeconds % 60).padStart(2, '0');
  timerDisplay.textContent = `${minutes}:${seconds}`;
  focusMeta.textContent = `当前任务：${timerTaskName}`;
}

function startTimer(minutes, taskName) {
  timerTaskName = taskName || '专注时段';
  timerSeconds = minutes * 60;
  updateTimerDisplay();
  if (timerId) {
    clearInterval(timerId);
  }
  timerId = window.setInterval(() => {
    if (timerSeconds <= 0) {
      clearInterval(timerId);
      timerId = null;
      timerDisplay.textContent = '00:00';
      setStatus('倒计时结束');
      return;
    }
    timerSeconds -= 1;
    updateTimerDisplay();
  }, 1000);
}

function enableFocusTheme(fullscreen, audioBgm) {
  document.body.classList.add('focus-mode');
  focusModeEnabled = true;
  if (fullscreen) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  }
  if (audioBgm) {
    startAmbientAudio();
  }
}

function startAmbientAudio() {
  if (ambientAudioCtx) {
    return;
  }
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    return;
  }
  ambientAudioCtx = new AudioContextClass();
  ambientGain = ambientAudioCtx.createGain();
  ambientGain.gain.value = 0.02;
  ambientGain.connect(ambientAudioCtx.destination);

  const bufferSize = ambientAudioCtx.sampleRate * 2;
  const noiseBuffer = ambientAudioCtx.createBuffer(1, bufferSize, ambientAudioCtx.sampleRate);
  const output = noiseBuffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i += 1) {
    output[i] = (Math.random() * 2 - 1) * 0.5;
  }
  const noiseSource = ambientAudioCtx.createBufferSource();
  noiseSource.buffer = noiseBuffer;
  noiseSource.loop = true;
  noiseSource.connect(ambientGain);
  noiseSource.start();
}

function renderTodoList(todos) {
  todoList.innerHTML = '';
  todos.forEach((todo) => {
    const item = document.createElement('label');
    item.className = 'todo-item';
    item.innerHTML = `<input type="checkbox" ${todo.done ? 'checked' : ''} /> <span>${todo.title}</span>`;
    todoList.appendChild(item);
  });
}

function showAwardModal(title, message) {
  awardTitle.textContent = title || '成就解锁';
  awardMessage.textContent = message || '你已经完成了一个专注回合。';
  awardModal.classList.remove('hidden');
  createConfetti();
}

function createConfetti() {
  for (let i = 0; i < 24; i += 1) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.top = '-20px';
    piece.style.background = ['#5ee7d9', '#7c6cff', '#ff8c42', '#ff5f7e'][i % 4];
    piece.style.animationDelay = `${Math.random() * 0.2}s`;
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 1400);
  }
}

function executeClientAction(action, payload = {}) {
  switch (action) {
    case 'START_TIMER':
    case 'START_MICRO_STEP':
      startTimer(payload.minutes || 25, payload.task_name || payload.micro_task || '专注时段');
      break;
    case 'ENTER_FOCUS_MODE':
      enableFocusTheme(payload.enable_fullscreen, payload.audio_bgm);
      break;
    case 'RENDER_TODOS':
      renderTodoList(payload.todos || []);
      break;
    case 'TRIGGER_AWARD':
      showAwardModal(payload.badge_title, payload.message);
      break;
    case 'RESET_CONTEXT':
      resetContext();
      break;
    default:
      break;
  }
}

function parseAgentAction(responseText) {
  const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
  if (jsonMatch) {
    try {
      const command = JSON.parse(jsonMatch[1]);
      const cleanText = responseText.replace(/```json[\s\S]*?```/, '').trim();
      executeClientAction(command.action, command.payload || {});
      return cleanText;
    } catch (error) {
      console.error('JSON 解析失败', error);
    }
  }
  return responseText;
}

function streamAssistantReply(inputText) {
  appendMessageToConversation('user', inputText);
  setStatus('正在流式回复…');
  const assistantBubble = document.createElement('div');
  assistantBubble.className = 'message assistant';
  assistantBubble.textContent = '正在思考…';
  messageList.appendChild(assistantBubble);
  messageList.scrollTop = messageList.scrollHeight;

  fetch('/api/coze/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: inputText,
      bot_id: DEFAULT_BOT_ID,
      conversation_id: currentConversationId,
      user_id: 'local_user_01'
    })
  })
    .then(async (response) => {
      if (!response.ok) {
        throw new Error('请求失败');
      }
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无响应体');
      }
      const decoder = new TextDecoder();
      let buffer = '';
      let fullText = '';

      const extractStreamText = (parsed) => {
        if (!parsed || typeof parsed !== 'object') {
          return '';
        }
        if (typeof parsed.text === 'string' && parsed.text) {
          return parsed.text;
        }
        if (typeof parsed.answer === 'string' && parsed.answer) {
          return parsed.answer;
        }
        if (typeof parsed.message === 'string' && parsed.message) {
          return parsed.message;
        }
        if (parsed.content && typeof parsed.content === 'object') {
          if (typeof parsed.content.text === 'string' && parsed.content.text) {
            return parsed.content.text;
          }
          if (typeof parsed.content.answer === 'string' && parsed.content.answer) {
            return parsed.content.answer;
          }
        }
        return '';
      };

      const parseChunk = (chunk) => {
        const normalized = chunk.replace(/^event:\s.*$/gm, '').trim();
        const pieces = normalized.split(/\n{2,}/).filter(Boolean);
        let collected = '';

        for (const piece of pieces) {
          const lines = piece.split('\n').map((line) => line.trim());
          for (const line of lines) {
            if (!line.startsWith('data:')) {
              continue;
            }
            const raw = line.slice(5).trim();
            if (!raw) {
              continue;
            }
            try {
              const parsed = JSON.parse(raw);
              const text = extractStreamText(parsed);
              if (text) {
                collected += text;
              }
            } catch {
              collected += `${raw}\n`;
            }
          }
        }
        return collected;
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        const chunkText = parseChunk(buffer);
        if (chunkText) {
          fullText += chunkText;
          assistantBubble.textContent = fullText.trim() || '正在思考…';
        }
        const lastBoundary = buffer.lastIndexOf('\n\n');
        if (lastBoundary >= 0) {
          buffer = buffer.slice(lastBoundary + 2);
        }
      }

      const cleanedText = parseAgentAction(fullText.trim());
      const finalText = cleanedText || fullText.trim() || '已收到你的请求。';
      assistantBubble.textContent = finalText;
      const conversation = getCurrentConversation();
      if (conversation) {
        conversation.messages.push({ role: 'assistant', text: finalText, createdAt: new Date().toISOString() });
        saveConversations();
      }
      setStatus('回复完成');
    })
    .catch((error) => {
      console.error(error);
      assistantBubble.textContent = '当前无法连接到 Coze 服务，请查看服务端日志或启用模拟模式。';
      setStatus('连接异常');
    });
}

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) {
    return;
  }
  input.value = '';
  streamAssistantReply(text);
});

newConversationBtn.addEventListener('click', () => {
  const conversation = createConversation();
  setCurrentConversation(conversation.id);
  resetContext();
});

startTimerBtn.addEventListener('click', () => {
  startTimer(25, '阅读论文');
});

microStepBtn.addEventListener('click', () => {
  startTimer(5, '整理笔记');
});

closeAwardBtn.addEventListener('click', () => {
  awardModal.classList.add('hidden');
});

awardModal.addEventListener('click', (event) => {
  if (event.target === awardModal) {
    awardModal.classList.add('hidden');
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    visibilityTimer = window.setTimeout(() => {
      if (!document.hidden) {
        return;
      }
      streamAssistantReply('用户离开页面超过 10 秒，给出一条简短提示，帮助他重新回到专注状态。');
    }, 10_000);
  } else if (visibilityTimer) {
    clearTimeout(visibilityTimer);
  }
});

function generateConversationId() {
  if (window.crypto?.randomUUID) {
    return `conv_${window.crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `conv_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

function formatTimestamp(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function createConversation() {
  const conversation = {
    id: generateConversationId(),
    title: '新对话',
    createdAt: formatTimestamp(),
    messages: []
  };
  conversations.unshift(conversation);
  saveConversations();
  renderConversationList();
  return conversation;
}

function loadConversations() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (Array.isArray(saved) && saved.length) {
      conversations = saved;
      return;
    }
  } catch {
    // ignore invalid storage
  }
  conversations = [
    {
      id: generateConversationId(),
      title: '新对话',
      createdAt: formatTimestamp(),
      messages: []
    }
  ];
  saveConversations();
}

function loadCurrentConversationId() {
  const savedId = localStorage.getItem(CURRENT_CONVERSATION_KEY);
  if (savedId && conversations.some((item) => item.id === savedId)) {
    currentConversationId = savedId;
  } else {
    currentConversationId = conversations[0].id;
  }
}

function saveConversations() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
}

function getCurrentConversation() {
  const conversation = conversations.find((item) => item.id === currentConversationId);
  if (conversation) {
    return conversation;
  }
  return conversations[0];
}

function renderConversationList() {
  conversationList.innerHTML = '';
  conversations.forEach((conversation) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = `conversation-item${conversation.id === currentConversationId ? ' selected' : ''}`;
    item.innerHTML = `<h3>${conversation.title}</h3><p>${conversation.createdAt}</p>`;
    item.addEventListener('click', () => {
      setCurrentConversation(conversation.id);
    });
    conversationList.appendChild(item);
  });
}

function renderMessages() {
  const conversation = getCurrentConversation();
  messageList.innerHTML = '';
  conversation.messages.forEach((message) => {
    addMessage(message.role, message.text);
  });
}

function setCurrentConversation(conversationId) {
  currentConversationId = conversationId;
  localStorage.setItem(CURRENT_CONVERSATION_KEY, conversationId);
  renderConversationList();
  renderMessages();
  const conversation = getCurrentConversation();
  setStatus(`当前会话：${conversation.title}`);
}

function appendMessageToConversation(role, text) {
  const conversation = getCurrentConversation();
  if (!conversation) {
    return;
  }
  if (role === 'user' && conversation.messages.length === 0 && conversation.title === '新对话') {
    conversation.title = text.slice(0, 20);
  }
  conversation.messages.push({ role, text, createdAt: new Date().toISOString() });
  saveConversations();
  if (role === 'user') {
    renderConversationList();
  }
  addMessage(role, text);
}

function stopAmbientAudio() {
  if (ambientAudioCtx) {
    ambientAudioCtx.close().catch(() => {});
    ambientAudioCtx = null;
    ambientGain = null;
  }
}

function resetContext() {
  if (timerId) {
    clearInterval(timerId);
    timerId = null;
  }
  timerSeconds = 25 * 60;
  timerTaskName = '专注时段';
  updateTimerDisplay();
  renderTodoList([]);
  document.body.classList.remove('focus-mode');
  focusModeEnabled = false;
  stopAmbientAudio();
  awardModal.classList.add('hidden');
  setStatus('当前上下文已重置');
}

loadConversations();
loadCurrentConversationId();
setCurrentConversation(getCurrentConversation().id);
updateTimerDisplay();
renderTodoList([{ title: '准备学习目标', done: false }, { title: '启动专注时段', done: false }]);
setStatus('准备就绪');
