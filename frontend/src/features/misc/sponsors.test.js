// @vitest-environment jsdom
// sponsors.test.js — 赞助者列表渲染与筛选单元测试
import { beforeEach, describe, expect, it } from 'vitest';
import {
  filterSponsors,
  renderSponsors,
  SPONSORS,
  toggleShowMoreSponsors,
} from './sponsors.js';

function mountSponsors() {
  document.body.innerHTML = `
    <div id="sponsor-list"></div>
    <div id="sponsor-count"></div>
    <button id="sponsor-more-btn">展开更多 </button>
  `;
}

beforeEach(() => {
  mountSponsors();
});

describe('renderSponsors', () => {
  it('渲染全部赞助者并显示人数', () => {
    renderSponsors();
    const list = document.getElementById('sponsor-list');
    expect(list.querySelectorAll('.sponsor-tag').length).toBe(SPONSORS.length);
    expect(document.getElementById('sponsor-count').textContent).toBe(`${SPONSORS.length} 人`);
    expect(list.textContent).toContain('爱发电用户_f6954');
  });

  it('按关键词筛选，无匹配显示空提示', () => {
    renderSponsors('不存在的人');
    expect(document.getElementById('sponsor-list').textContent).toContain('未找到匹配的赞助者');
  });

  it('容器不存在时静默返回', () => {
    document.body.innerHTML = '';
    expect(() => renderSponsors()).not.toThrow();
  });
});

describe('filterSponsors / toggleShowMoreSponsors', () => {
  it('筛选时展开列表并隐藏更多按钮', () => {
    filterSponsors('爱发电');
    const grid = document.getElementById('sponsor-list');
    expect(grid.classList.contains('expanded')).toBe(true);
    expect(document.getElementById('sponsor-more-btn').style.display).toBe('none');
    expect(grid.textContent).toContain('爱发电用户');
  });

  it('切换展开状态与按钮文案', () => {
    const grid = document.getElementById('sponsor-list');
    const button = document.getElementById('sponsor-more-btn');
    toggleShowMoreSponsors();
    expect(grid.classList.contains('expanded')).toBe(true);
    expect(button.classList.contains('expanded')).toBe(true);
    expect(button.childNodes[0].textContent).toBe('收起 ');
    toggleShowMoreSponsors();
    expect(grid.classList.contains('expanded')).toBe(false);
    expect(button.childNodes[0].textContent).toBe('展开更多 ');
  });
});
