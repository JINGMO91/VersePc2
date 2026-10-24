// accounts-actions.js — 账户域 data-action 注册
import { registerActions as registerActions } from '../../core/actions.js';
import { toggleMod, deleteMod } from './accounts-home.js';
import { selectAccount, deleteAccount, showAccountDetail } from './accounts-list.js';
import { selectThirdPartyProfile } from './accounts-auth.js';

registerActions({
  showAccountDetail: (event, el, accountId) => showAccountDetail(accountId),
  selectAccount: (event, el, accountId) => selectAccount(accountId),
  deleteAccount: (event, el, accountId) => deleteAccount(accountId),
  selectThirdPartyProfile: (event, el, profileId, profileName) => selectThirdPartyProfile(profileId, profileName),
  toggleMod: (event, el, modId, enabled) => toggleMod(modId, enabled),
  deleteMod: (event, el, modId) => deleteMod(modId),
});
