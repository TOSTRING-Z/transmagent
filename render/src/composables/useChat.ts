import { ref, onMounted, onUnmounted, nextTick, type Ref } from 'vue';

export interface ChatMessage {
  group_id: string;
  role: 'user' | 'system' | string;
  content: string;
  infoContent?: string;
  thinking?: boolean;
}

export function useChat(topDivRef?: Ref<HTMLElement | null>, options?: { 
  streamEvent?: string, 
  infoEvent?: string, 
  userEvent?: string,
  sendEvent?: string
}) {
  const messages = ref<ChatMessage[]>([]);
  const tokens = ref(0);
  const msgCount = ref(0);
  const seconds = ref(0);
  const progress = ref(0);

  const streamEvent = options?.streamEvent || 'streamData';
  const infoEvent = options?.infoEvent || 'infoData';
  const userEvent = options?.userEvent || 'userData';
  const sendEvent = options?.sendEvent || 'user-send-message';

  let ipcRenderer: any = null;
  try {
    if (typeof window !== 'undefined' && (window as any).require) {
      ipcRenderer = (window as any).require('electron').ipcRenderer;
    } else {
      // For Node environment or tests
      try {
        ipcRenderer = require('electron').ipcRenderer;
      } catch (e) {}
    }
  } catch (e) { 
    console.warn('Electron not available'); 
  }

  const scrollToBottom = () => {
    nextTick(() => {
      if (topDivRef && topDivRef.value) {
        topDivRef.value.scrollTop = topDivRef.value.scrollHeight;
      }
    });
  };

  const onStreamData = (_event: any, chunk: any) => {
    let targetMsg = messages.value.find(m => m.group_id === chunk.id);
    if (!targetMsg) {
      targetMsg = {
        group_id: chunk.id,
        role: 'system',
        content: '',
        thinking: true
      };
      messages.value.push(targetMsg);
    }
    
    if (chunk.content) {
      targetMsg.content += chunk.content;
    }
    
    if (chunk.end) {
      targetMsg.thinking = false;
    }
    scrollToBottom();
  };

  const onInfoData = (_event: any, info: any) => {
    let targetMsg = messages.value.find(m => m.group_id === info.id);
    if (targetMsg && info.content) {
      targetMsg.infoContent = (targetMsg.infoContent || '') + info.content;
      scrollToBottom();
    }
  };

  const onUserData = (_event: any, data: any) => {
    const content = typeof data.content === 'string' ? data.content : data.content?.text?.content || '';
    messages.value.push({
      group_id: data.id,
      role: 'user',
      content: content,
    });
    scrollToBottom();
  };

  const sendMessage = (val: string, mode: string = 'act') => {
    const msgId = Date.now().toString();
    messages.value.push({
      group_id: msgId,
      role: 'user',
      content: val,
    });
    scrollToBottom();
    
    if (ipcRenderer) {
      ipcRenderer.send(sendEvent, { content: val, mode, id: msgId });
    }
  };

  onMounted(() => {
    if (ipcRenderer) {
      ipcRenderer.on(streamEvent, onStreamData);
      ipcRenderer.on(infoEvent, onInfoData);
      ipcRenderer.on(userEvent, onUserData);
    }
  });

  onUnmounted(() => {
    if (ipcRenderer) {
      ipcRenderer.removeListener(streamEvent, onStreamData);
      ipcRenderer.removeListener(infoEvent, onInfoData);
      ipcRenderer.removeListener(userEvent, onUserData);
    }
  });

  return {
    messages,
    tokens,
    msgCount,
    seconds,
    progress,
    sendMessage,
    scrollToBottom
  };
}
