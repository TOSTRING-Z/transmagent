import { reactive } from 'vue';

export interface ChatMessage {
  id: string;
  role: 'user' | 'system';
  content: string;
  isStreaming?: boolean;
}

export const useChatStore = () => {
  const state = reactive({
    messages: [] as ChatMessage[],
    systemPrompt: '',
    tokens: 0,
    currentMode: 'auto' as 'auto' | 'act' | 'plan' | 'flash',
    history: [] as any[]
  });

  const addMessage = (msg: ChatMessage) => {
    state.messages.push(msg);
  };

  const clearMessages = () => {
    state.messages = [];
  };

  return {
    state,
    addMessage,
    clearMessages
  };
};