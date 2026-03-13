import { State } from './globals';
import { userData, infoData, streamData, startAgentLoop, toolData } from './chat';

window.electronAPI.handleMarkDownFormat((status) => State.markdown_statu = status);

window.electronAPI.streamData((chunk) => streamData(chunk));

window.electronAPI.toolData((chunk) => toolData(chunk));

window.electronAPI.infoData((info) => infoData(info));

window.electronAPI.userData((data) => userData(data));

window.electronAPI.startAgentLoop(async (data) => startAgentLoop(data));