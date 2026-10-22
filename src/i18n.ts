import type { Language } from './shared';

export function resolveLanguage(language: Language): 'en' | 'zh-CN' {
  if (language !== 'auto') return language;
  const browserLanguage =
    globalThis.chrome?.i18n?.getUILanguage?.() ?? globalThis.navigator?.language ?? 'en';
  return /^zh(?:-|$)/i.test(browserLanguage) ? 'zh-CN' : 'en';
}

const chinese: Record<string, string> = {
  Language: '语言',
  'Based on': '原仓库：',
  ' · Saved': ' · 已保存',
  'Browser language': '跟随浏览器',
  'Enable real-time scanning': '启用实时检测',
  Detector: '检测器',
  'Decision model': '决策模型',
  'GPTZero connection': 'GPTZero 连接',
  Access: '访问方式',
  Free: '免费',
  'Your key': '自有 Key',
  'Your API key': '自有 API Key',
  'API key': 'API Key',
  'GPTZero API key': 'GPTZero API Key',
  'Provider and API key': '服务商与 API Key',
  Provider: '服务商',
  'Get a key': '获取 Key',
  'Remove saved key': '移除已保存的 Key',
  'Add key': '添加 Key',
  Connected: '已连接',
  'Connected.': '已连接。',
  Connect: '连接',
  'Allow access': '允许访问',
  'Allowing…': '正在授权…',
  'Saving…': '正在保存…',
  'Saving key…': '正在保存 Key…',
  'Checking…': '正在检查…',
  'Connecting…': '正在连接…',
  Cancel: '取消',
  Show: '显示',
  Hide: '隐藏',
  'Show API key': '显示 API Key',
  'Hide API key': '隐藏 API Key',
  'Show GPTZero API key': '显示 GPTZero API Key',
  'Hide GPTZero API key': '隐藏 GPTZero API Key',
  'Paste your API key': '粘贴你的 API Key',
  'Paste your GPTZero API key': '粘贴你的 GPTZero API Key',
  'Paste a replacement key': '粘贴新的 Key',
  'Allow GPTZero access': '允许访问 GPTZero',
  'Connect GPTZero': '连接 GPTZero',
  'Enable GPTZero': '启用 GPTZero',
  'Free scanning unavailable': '免费检测暂不可用',
  Paused: '已暂停',
  Appearance: '显示设置',
  'On slop': '发现 Slop 时',
  Stamp: '盖章',
  'Fade out': '淡化',
  'Show not-slop': '显示非 Slop 标签',
  'Show score': '显示分数',
  'Slop threshold': 'Slop 判定阈值',
  'Threshold percentage': '阈值百分比',
  'Reset to 70%': '恢复为 70%',
  'Threshold must be a whole number from 0 to 100.': '阈值必须是 0 到 100 之间的整数。',
  'Slop probability ≥ {threshold}% is Slop. Changes save automatically.':
    'Slop 概率 ≥ {threshold}% 即判为 Slop，修改后自动保存。',
  Prompt: '提示词',
  Default: '默认',
  Custom: '自定义',
  Unsaved: '未保存',
  'Save prompt': '保存提示词',
  'Reset to default': '恢复默认',
  'Clear cache': '清除缓存',
  'Detector paused': '检测已暂停',
  'Open Slop Detector settings': '打开 Slop Detector 设置',
  'Allow provider access': '允许访问服务商',
  Slop: 'Slop（低质内容）',
  'Not slop': '非 Slop',
  Unrated: '未评分',
  'Unable to rate this text': '无法评估这段文字',
  'Unable to rate this text.': '无法评估这段文字。',
  'Free limit reached': '免费额度已用完',
  'Free limit reached.': '免费额度已用完。',
  'GPTZero request timed out.': 'GPTZero 请求超时。',
  'Couldn’t rate · retry': '评估失败 · 重试',
  'Retry this post': '重新评估此帖',
  Queued: '排队中',
  'Hide post': '隐藏帖子',
  'Show post': '显示帖子',
  'Slop detected': '检测到 Slop',
  '{text}, {score} percent confidence': '{text}，置信度 {score}%',
  'Extension unavailable. Reload it.': '扩展暂不可用，请重新加载。',
  'Request failed. Reload the extension.': '请求失败，请重新加载扩展。',
  'Access was not granted.': '未获得访问权限。',
  'Choose a supported provider.': '请选择支持的服务商。',
  'Invalid API key.': 'API Key 无效。',
  'Key check in progress.': '正在检查 Key。',
  'Key check cancelled.': 'Key 检查已取消。',
  'Key check timed out.': 'Key 检查超时。',
  'Key check timed out after 20 seconds.': 'Key 检查在 20 秒后超时。',
  'Request timed out.': '请求超时。',
  'Your GPTZero credits have run out.': '你的 GPTZero 额度已用完。',
  'GPTZero is not configured': '尚未配置 GPTZero',
  'GPTZero proxy is unavailable': 'GPTZero 代理暂不可用',
  'GPTZero is connecting.': '正在连接 GPTZero。',
  'Unsupported request.': '不支持此请求。',
  'Unsupported sender.': '不支持此请求来源。',
  'Prompt must be 1–{max} characters.': '提示词长度必须为 1–{max} 个字符。',
  '{count} checked this session': '本次已检测 {count} 条',
  '{remaining} / {limit} free checks left': '剩余免费次数 {remaining} / {limit}',
  'Resets {time}': '重置时间：{time}',
};

// Worker messages retain an English wire format and are localized at display time.
const patterns: [RegExp, string][] = [
  [/^Powered by (.+)$/, '由 $1 提供支持'],
  [/^Connect (.+)$/, '连接 $1'],
  [/^Checking with (.+)$/, '正在使用 $1 检测'],
  [/^Queued for (.+)$/, '等待 $1 检测'],
  [/^Access to (.+) was not granted\.$/, '未获得 $1 访问权限。'],
  [/^(.+) access required\.$/, '需要 $1 访问权限。'],
  [/^Check your (.+) key\.$/, '请检查你的 $1 Key。'],
  [/^(.+) credits exhausted\.$/, '$1 额度已用完。'],
  [/^(.+) rate limit reached\.$/, '$1 请求过于频繁。'],
  [/^Cannot reach (.+)\.$/, '无法连接 $1。'],
  [/^Invalid (.+) (?:result|response)\.?$/, '$1 返回了无效结果。'],
  [/^(.+) unavailable\.$/, '$1 暂不可用。'],
  [/^Prompt must be 1–(\d+) characters\.$/, '提示词长度必须为 1–$1 个字符。'],
];

export function translate(
  language: Language,
  text: string,
  values: Record<string, string | number> = {},
): string {
  let result = text;
  if (resolveLanguage(language) === 'zh-CN') {
    result = chinese[text] ?? text;
    if (result === text)
      for (const [pattern, replacement] of patterns) {
        if (pattern.test(text)) {
          result = text.replace(pattern, replacement);
          break;
        }
      }
  }
  return result.replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match));
}

export function localizePopup(language: Language) {
  document.documentElement.lang = resolveLanguage(language);
  for (const attribute of ['text', 'aria-label', 'placeholder'])
    for (const element of document.querySelectorAll<HTMLElement>(`[data-i18n-${attribute}]`)) {
      const value = translate(language, element.getAttribute(`data-i18n-${attribute}`) ?? '');
      if (attribute === 'text') element.textContent = value;
      else element.setAttribute(attribute, value);
    }
}
