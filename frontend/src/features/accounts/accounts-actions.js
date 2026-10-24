// accounts-actions.js — 账户域 data-action 注册
import { registerActions as registerActions } from '../../core/actions.js';
import { selectAccount, deleteAccount, showAccountDetail } from './accounts-list.js';
import { selectThirdPartyProfile } from './accounts-auth.js';

// 账户主页的模组开关面板依赖模组模块，触发动作用时再加载，避免进入启动包
const loadAccountsHome = () => import('./accounts-home.js');

registerActions({
  showAccountDetail: (event, el, accountId) => showAccountDetail(accountId),
  selectAccount: (event, el, accountId) => selectAccount(accountId),
  deleteAccount: (event, el, accountId) => deleteAccount(accountId),
  selectThirdPartyProfile: (event, el, profileId, profileName) => selectThirdPartyProfile(profileId, profileName),
  toggleMod: (event, el, modId, enabled) => loadAccountsHome().then((m) => m.toggleMod(modId, enabled)),
  deleteMod: (event, el, modId) => loadAccountsHome().then((m) => m.deleteMod(modId)),
});
