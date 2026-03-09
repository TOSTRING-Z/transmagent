<template>
  <div class="overlaywindow-wrapper">
    <img id="img" style="border: 1px solid black; display: none;" src="" alt="" />
    <div 
      id="selection-box" 
      v-show="isCapturing"
      :style="{
        left: selectionBoxStyle.left + 'px',
        top: selectionBoxStyle.top + 'px',
        width: selectionBoxStyle.width + 'px',
        height: selectionBoxStyle.height + 'px'
      }"
    ></div>
  </div>
</template>

<script setup lang="ts">
// @ts-nocheck
import { ref, onMounted, onUnmounted, reactive } from 'vue';

let ipcRenderer: any = null;
try {
  if (typeof window !== 'undefined' && (window as any).require) {
    ipcRenderer = (window as any).require('electron').ipcRenderer;
  } else {
    ipcRenderer = require('electron').ipcRenderer;
  }
} catch (e) { console.warn('Electron not available'); }

const isCapturing = ref(false);
const selectionBoxStyle = reactive({ left: 0, top: 0, width: 0, height: 0 });
let startX = 0;
let startY = 0;

async function captureScreen(source: any, captureRect: any) {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: source.id,
        minWidth: 1920,
        maxWidth: 4096,
        minHeight: 1080,
        maxHeight: 4096
      }
    } as any
  });

  const video = document.createElement('video');
  video.srcObject = stream;
  await video.play();

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  canvas.width = captureRect.width;
  canvas.height = captureRect.height;
  
  await new Promise(resolve => setTimeout(resolve, 300));
  
  if (ctx) {
    ctx.drawImage(
      video,
      captureRect.x, captureRect.y,
      captureRect.width, captureRect.height,
      0, 0,
      captureRect.width, captureRect.height
    );
  }
  
  const screenshot = canvas.toDataURL('image/png');

  stream.getTracks().forEach(track => track.stop());
  video.remove();

  return screenshot;
}

function updateSelectionBox(e: MouseEvent) {
  selectionBoxStyle.left = Math.min(e.clientX, startX);
  selectionBoxStyle.top = Math.min(e.clientY, startY);
  selectionBoxStyle.width = Math.abs(e.clientX - startX);
  selectionBoxStyle.height = Math.abs(e.clientY - startY);
}

const onMouseDown = (e: MouseEvent) => {
  isCapturing.value = true;
  startX = e.clientX;
  startY = e.clientY;
  updateSelectionBox(e);
};

const onMouseMove = (e: MouseEvent) => {
  if (!isCapturing.value) return;
  updateSelectionBox(e);
};

const onMouseUp = async (e: MouseEvent) => {
  if (!isCapturing.value) return;
  isCapturing.value = false;
  
  const dpr = window.devicePixelRatio || 1;
  if (ipcRenderer) {
    try {
      const { source, captureRect } = await ipcRenderer.invoke('capture-region', {
        start: { x: startX, y: startY },
        end: { x: e.clientX, y: e.clientY },
        dpr
      });
      const img_url = await captureScreen(source, captureRect);
      ipcRenderer.send('query-img', img_url);
    } catch (err) {
      console.error('Capture error:', err);
    }
  }
};

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key === 'Escape' || e.keyCode === 27) {
    window.close();
  }
};

onMounted(() => {
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('keydown', onKeyDown);
});

onUnmounted(() => {
  document.removeEventListener('mousedown', onMouseDown);
  document.removeEventListener('mousemove', onMouseMove);
  document.removeEventListener('mouseup', onMouseUp);
  document.removeEventListener('keydown', onKeyDown);
});
</script>

<style scoped>
* {
  margin: 0;
  padding: 0;
  cursor: crosshair;
}
#selection-box {
  position: fixed;
  border: 2px solid #ff0000;
  background: rgba(255, 0, 0, 0.2);
}
.overlaywindow-wrapper {
  width: 100vw;
  height: 100vh;
}
</style>