// lib/utils.js — 组件层通用工具
// cn 用于合并 Tailwind 类名：clsx 处理条件类，tailwind-merge 去除冲突类。
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
