/**
 * useVoiceInput — 语音输入（Web Speech API，中文）（A6 拆分自 CopilotDrawer.vue）
 *
 * 职责：封装语音识别生命周期，提供 recognizing 状态与 toggleVoice。
 * 仅在支持的浏览器（Chrome/Edge）启用；不支持时通过 onError 回调提示。
 */
import { ref } from 'vue'

export function useVoiceInput({ onError } = {}) {
  const recognizing = ref(false)
  const speechOk = typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)
  let _recog = null

  function toggleVoice(onResult) {
    if (!speechOk) {
      if (onError) onError('当前浏览器不支持语音输入，请用 Chrome 浏览器')
      return
    }
    if (recognizing.value) {
      _recog && _recog.stop()
      return
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    const r = new SR()
    r.lang = 'zh-CN'
    r.interimResults = true
    r.continuous = false
    r.onresult = (e) => {
      let t = ''
      for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript
      if (onResult) onResult(t)
    }
    r.onerror = () => { recognizing.value = false }
    r.onend = () => { recognizing.value = false }
    _recog = r
    r.start()
    recognizing.value = true
  }

  return { recognizing, speechOk, toggleVoice }
}
