import { terracottaHostStep1, terracottaJoinStep1 } from './lan-terracotta.js';
import { detectLanPort } from './lan-port.js';

function switchLanTab(page, tab, btnEl) {
    const tabsContainer = btnEl.closest('.lan-tabs');
    if (tabsContainer) tabsContainer.querySelectorAll('.lan-tab').forEach(t => t.classList.remove('active'));
    btnEl.classList.add('active');

    if (page === 'terracotta') {
        const connected = document.getElementById('terracotta-connected');
        if (connected && connected.style.display !== 'none') return;
        if (tab === 'host') {
            terracottaHostStep1();
        } else {
            terracottaJoinStep1();
        }
    }
}

function showLanStep(prefix, flow, step) {
    const flowEl = document.getElementById(prefix + '-' + flow + '-panel');
    if (!flowEl) return;
    for (let i = 1; i <= 3; i++) {
        const st = flowEl.querySelector('#' + prefix + '-' + flow + '-step' + i);
        if (st) st.style.display = i === step ? '' : 'none';
    }
    const stepEl = flowEl.querySelector('#' + prefix + '-' + flow + '-step' + step);
    if (stepEl) {
        stepEl.classList.remove('terracotta-step--enter');
        void stepEl.offsetWidth;
        stepEl.classList.add('terracotta-step--enter');
    }
}

export { switchLanTab, detectLanPort, showLanStep };
