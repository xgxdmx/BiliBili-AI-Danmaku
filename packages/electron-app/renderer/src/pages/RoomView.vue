<script setup lang="ts">
import { reactive, ref, onMounted, onUnmounted, computed, watch } from "vue";

interface RoomForm {
  roomId: number | string;
  enabled: boolean;
  minMedalLevel: number;
}

interface Creds {
  sessdata: string;
  biliJct: string;
  buvid3: string;
}

const form = reactive<RoomForm>({ roomId: "", enabled: true, minMedalLevel: 0 });

// 凭证相关
const creds = reactive<Creds>({ sessdata: "", biliJct: "", buvid3: "" });
const saved = ref(false);
const showInputSessdata = ref(false);
const showInputBiliJct = ref(false);
const showPreviewSessdata = ref(false);
const showPreviewBiliJct = ref(false);
const rawCookie = ref("");
const sendBeforeDisconnect = ref(true);
const disconnectMessage = ref("先下播啦，感谢大家陪伴，我们下次见～");
let roomPrefsReady = false;
let disconnectSaveTimer: ReturnType<typeof setTimeout> | null = null;
let roomIdSaveTimer: ReturnType<typeof setTimeout> | null = null;

// 解析Cookie
function parseCookie() {
  const cookie = rawCookie.value;
  if (!cookie) return;
  
  // 解析 SESSDATA, bili_jct, buvid3
  const sessMatch = cookie.match(/SESSDATA=([^;]+)/);
  const biliMatch = cookie.match(/bili_jct=([^;]+)/);
  const buvidMatch = cookie.match(/buvid3=([^;]+)/);
  
  if (sessMatch) creds.sessdata = sessMatch[1];
  if (biliMatch) creds.biliJct = biliMatch[1];
  if (buvidMatch) creds.buvid3 = buvidMatch[1];
  
  if (sessMatch || biliMatch || buvidMatch) {
    autoSave();
    rawCookie.value = "";
  }
}

// 是否已配置
const isConfigured = computed(() => !!creds.sessdata && !!creds.biliJct);

// 格式化显示
const formattedCreds = computed(() => {
  const arr: string[] = [];
  const s = creds.sessdata || "";
  const b = creds.biliJct || "";
  const u = creds.buvid3 || "";
  if (s) {
    let display = s;
    try { display = decodeURIComponent(s); } catch {}
    arr.push(`SESSDATA=${showPreviewSessdata.value ? display : display.substring(0, 30) + "..."}`);
  }
  if (b) arr.push(`bili_jct=${showPreviewBiliJct.value ? b : "********"}`);
  if (u) arr.push(`buvid3=${u}`);
  return arr.join("; ");
});

// 自动保存
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function autoSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      await window.danmakuAPI?.setConfig("credentials", { ...creds });
      saved.value = true;
      setTimeout(() => saved.value = false, 1500);
    } catch {
      // 保存失败时静默处理
    }
  }, 500);
}

watch([sendBeforeDisconnect, disconnectMessage], () => {
  if (!roomPrefsReady) return;
  if (disconnectSaveTimer) clearTimeout(disconnectSaveTimer);
  disconnectSaveTimer = setTimeout(async () => {
    try {
      await window.danmakuAPI?.setConfig("room.sendOnDisconnect", sendBeforeDisconnect.value);
      await window.danmakuAPI?.setConfig("room.disconnectMessage", disconnectMessage.value);
    } catch (e) {
      }
  }, 350);
});

watch(
  () => form.roomId,
  () => {
    if (!roomPrefsReady) return;
    if (roomIdSaveTimer) clearTimeout(roomIdSaveTimer);
    roomIdSaveTimer = setTimeout(async () => {
      try {
        const raw = String(form.roomId ?? "").trim();
        if (!raw) return;
        const roomId = Number(raw);
        if (!Number.isFinite(roomId) || roomId <= 0) return;
        await window.danmakuAPI?.setConfig("room.roomId", roomId);
      } catch (e) {
        }
    }, 350);
  }
);

watch(
  () => form.minMedalLevel,
  () => {
    if (!roomPrefsReady) return;
    if (disconnectSaveTimer) clearTimeout(disconnectSaveTimer);
    disconnectSaveTimer = setTimeout(async () => {
      try {
        const level = Math.max(0, Number(form.minMedalLevel || 0));
        form.minMedalLevel = level;
        await window.danmakuAPI?.setConfig("room.minMedalLevel", level);
        await window.danmakuAPI?.updateMinMedalLevel(level);
      } catch (e) {
        }
    }, 350);
  }
);

const isConnecting = ref(false);
const errorMsg = ref("");
const statusMsg = ref("");

const popupLoginLoading = ref(false);
const popupLoginStatus = ref("");
let offLoginStatus: (() => void) | null = null;

// 连接状态
const isConnected = ref(false);
const currentRoomId = ref<number | null>(null);

// 获取连接状态
async function fetchStatus() {
  try {
    const status = await window.danmakuAPI?.getStatus();
    isConnected.value = status?.connected || false;
    currentRoomId.value = status?.roomId || null;
    if (isConnected.value && currentRoomId.value) {
      form.roomId = currentRoomId.value;
    }
  } catch (e) { /* ignore */ }
}

// 定时检查连接状态
let statusTimer: ReturnType<typeof setInterval> | null = null;

onMounted(async () => {
  try {
    const config = await window.danmakuAPI?.getConfig();
    if (config?.room) {
      if (config.room.roomId && Number(config.room.roomId) > 0) {
        form.roomId = Number(config.room.roomId);
      }
      sendBeforeDisconnect.value = config.room.sendOnDisconnect ?? true;
      disconnectMessage.value = config.room.disconnectMessage || "先下播啦，感谢大家陪伴，我们下次见～";
      form.minMedalLevel = Number(config.room.minMedalLevel || 0);
    }
    if (config?.credentials) {
      creds.sessdata = config.credentials.sessdata || "";
      creds.biliJct = config.credentials.biliJct || "";
      creds.buvid3 = config.credentials.buvid3 || "";
    }
    roomPrefsReady = true;
    await fetchStatus();
    statusTimer = setInterval(fetchStatus, 5000);
  } catch (e) {
    }
});

onUnmounted(() => {
  if (statusTimer) clearInterval(statusTimer);
  if (disconnectSaveTimer) clearTimeout(disconnectSaveTimer);
  if (roomIdSaveTimer) clearTimeout(roomIdSaveTimer);
  offLoginStatus?.();
});

onMounted(() => {
  if (window.danmakuAPI?.onLoginStatus) {
    offLoginStatus = window.danmakuAPI.onLoginStatus((payload: any) => {
      if (payload?.message) {
        popupLoginStatus.value = payload.message;
      }
      if (payload?.state === "confirmed" && payload?.credentials) {
        creds.sessdata = payload.credentials.sessdata || "";
        creds.biliJct = payload.credentials.biliJct || "";
        creds.buvid3 = payload.credentials.buvid3 || "";
        autoSave();
      }
      if (payload?.state === "closed" || payload?.state === "confirmed") {
        popupLoginLoading.value = false;
      }
    });
  }
});

async function handleConnect() {
  if (!form.roomId) { errorMsg.value = "请输入直播间房间号"; return; }
  if (!isConfigured.value) { errorMsg.value = "请先填写 B站 Cookie"; return; }
  if (isConnected.value) { errorMsg.value = `已在监听房间 ${currentRoomId.value}，请先停止`; return; }
  
  const credentials = { ...creds };
  
  // 获取关键词配置
  let keywords: any[] = [];
  try {
    const config = await window.danmakuAPI?.getConfig();
    keywords = config?.keywords || [];
  } catch { keywords = []; }
  
  errorMsg.value = ""; statusMsg.value = "";
  isConnecting.value = true;
  try {
    const result = await window.danmakuAPI?.start({ 
      roomId: Number(form.roomId), 
      credentials, 
      keywords,
      minMedalLevel: Number(form.minMedalLevel || 0),
    });
    // 处理错误响应
    if ((result as any)?.status === "error") {
      errorMsg.value = (result as any).error || "连接失败";
      isConnecting.value = false;
      return;
    }
    statusMsg.value = "已连接";
    isConnected.value = true;
    currentRoomId.value = Number(form.roomId);
  } catch (e: any) {
    errorMsg.value = e?.message || "连接失败";
  } finally {
    isConnecting.value = false;
  }
}

async function handleDisconnect() {
  try {
    await window.danmakuAPI?.stop({
      sendBeforeStop: sendBeforeDisconnect.value,
      message: disconnectMessage.value,
    });
    statusMsg.value = "已断开"; 
    isConnected.value = false;
    currentRoomId.value = null;
  } catch (e: any) { errorMsg.value = e?.message || "断开失败"; }
}

async function openPopupLogin() {
  popupLoginLoading.value = true;
  popupLoginStatus.value = "正在打开登录窗口...";
  try {
    const result = await window.danmakuAPI?.openBiliLogin();
    if (result?.message) {
      popupLoginStatus.value = result.message;
    }
  } catch (e: any) {
    popupLoginStatus.value = e?.message || "打开登录窗口失败";
    popupLoginLoading.value = false;
  }
}
</script>

<template>
  <div class="page">
    <div class="page-header">
      <h2 class="page-title">直播间</h2>
    </div>

    <!-- 连接设置 -->
    <div class="card">
      <h3 class="card-title">连接设置</h3>

      <div class="field">
        <label class="field-label">房间号</label>
        <input v-model="form.roomId" type="text" inputmode="numeric" placeholder="例: 21452505" class="field-input" :disabled="isConnected" />
      </div>

      <div v-if="isConnected" class="status-bar">
        <span class="status-connected">正在监听房间 {{ currentRoomId }}</span>
      </div>

      <div class="btn-row">
        <button class="btn btn-accent" :disabled="isConnecting || !isConfigured || isConnected" @click="handleConnect">
          {{ isConnecting ? "连接中..." : "开始监听" }}
        </button>
        <button class="btn btn-muted" :disabled="!isConnected" @click="handleDisconnect">停止监听</button>
      </div>

      <div class="field">
        <label class="field-label">断开前发送告别弹幕</label>
        <div class="input-with-toggle" style="gap: 8px; align-items: center;">
          <input v-model="sendBeforeDisconnect" type="checkbox" style="width: 16px; height: 16px;" />
          <span style="font-size: 12px; color: var(--text-muted);">停止监听前自动发送一句话</span>
        </div>
      </div>

      <div class="field">
        <label class="field-label">最低粉丝牌等级过滤</label>
        <input
          v-model.number="form.minMedalLevel"
          type="number"
          min="0"
          step="1"
          class="field-input"
          placeholder="0 表示不过滤"
        />
        <div class="msg-inline">仅粉丝牌等级 ≥ 该值的弹幕会进入“匹配弹幕”和 AI 自动回复（源弹幕仍显示全部）。</div>
      </div>

      <div class="field">
        <label class="field-label">告别文案</label>
        <input
          v-model="disconnectMessage"
          type="text"
          class="field-input"
          :disabled="!sendBeforeDisconnect"
          placeholder="例如：先下播啦，感谢大家陪伴，我们下次见～"
        />
      </div>

      <div v-if="errorMsg" class="msg msg-error">{{ errorMsg }}</div>
      <div v-if="statusMsg" class="msg msg-success">{{ statusMsg }}</div>
    </div>

    <!-- B站凭证 -->
    <div class="card">
      <h3 class="card-title">B站凭证</h3>

      <div class="field">
        <label class="field-label">扫码登录（自动获取 Cookie）</label>
        <div class="btn-row" style="margin-bottom: 8px;">
          <button class="btn btn-accent" :disabled="popupLoginLoading" @click="openPopupLogin">
            {{ popupLoginLoading ? "登录窗口已打开" : "弹出B站登录页" }}
          </button>
        </div>
        <div v-if="popupLoginStatus" class="msg-inline">{{ popupLoginStatus }}</div>
      </div>
      
      <!-- 已配置的凭证预览 -->
      <div v-if="isConfigured" class="cookie-preview">
        <div class="cookie-header">
          <span class="cookie-label">已配置</span>
          <div class="toggle-btns">
            <button class="btn-link" @click="showPreviewSessdata = !showPreviewSessdata">
              {{ showPreviewSessdata ? "隐藏" : "显示" }} SESSDATA
            </button>
            <button class="btn-link" @click="showPreviewBiliJct = !showPreviewBiliJct">
              {{ showPreviewBiliJct ? "隐藏" : "显示" }} bili_jct
            </button>
          </div>
        </div>
        <pre class="cookie-value">{{ formattedCreds }}</pre>
      </div>
      
      <!-- 粘贴Cookie -->
      <div class="field">
        <label class="field-label">粘贴Cookie (自动识别)</label>
        <div class="input-with-toggle">
          <textarea v-model="rawCookie" placeholder="从浏览器开发者工具→Application→Cookies 复制整段Cookie粘贴至此" class="field-input" rows="2"></textarea>
          <button type="button" class="toggle-btn" @click="parseCookie">识别</button>
        </div>
      </div>

      <div class="field">
        <label class="field-label">SESSDATA</label>
        <div class="input-with-toggle">
          <input v-model="creds.sessdata" :type="showInputSessdata ? 'text' : 'password'" placeholder="浏览器 Cookie → SESSDATA" class="field-input" @blur="autoSave" />
          <button type="button" class="toggle-btn" @click="showInputSessdata = !showInputSessdata">{{ showInputSessdata ? '隐藏' : '显示' }}</button>
        </div>
      </div>

      <div class="field">
        <label class="field-label">bili_jct</label>
        <div class="input-with-toggle">
          <input v-model="creds.biliJct" :type="showInputBiliJct ? 'text' : 'password'" placeholder="浏览器 Cookie → bili_jct" class="field-input" @blur="autoSave" />
          <button type="button" class="toggle-btn" @click="showInputBiliJct = !showInputBiliJct">{{ showInputBiliJct ? '隐藏' : '显示' }}</button>
        </div>
      </div>

      <div class="field">
        <label class="field-label">buvid3 <span class="optional">可选</span></label>
        <div class="input-with-toggle">
          <input v-model="creds.buvid3" type="text" placeholder="浏览器 Cookie → buvid3" class="field-input" @blur="autoSave" />
        </div>
      </div>
      
      <div class="btn-row">
        <span v-if="saved" class="msg-inline msg-success">已自动保存</span>
      </div>
    </div>

    <div class="card">
      <h3 class="card-title">B站连接使用说明</h3>
      <div class="help-text">
        <ul>
          扫码登录：
          <li>单击“弹出B站登录页”按钮，使用Bilibili移动版APP进行扫码登录。</li>
        </ul>
        <ul>
          浏览器Cookie登录：
          <li>打开浏览器登录B站</li>
          <li>打开F12开发者工具，点击网络（Network）标签页，单击Fetch/XHR过滤器</li>
          <li>刷新B站，在F12开发者工具里可以看见许多请求项，找到标头（Headers）内请求标头（Request Headers）含有Cookie的数据项，并复制Cookie全部内容到工具输入框内</li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import "../styles/room.css";
</style>
