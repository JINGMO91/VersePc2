// vset-actions.js — data-action 注册
import { registerActions as registerActions } from '../../core/actions.js';
import { previewMod, toggleModInManager, removeModFromManager } from './vset-mods.js';
import { openModTranslateDialog } from './vset-translate.js';

registerActions({
  closeOverlay: (event, el) => el.closest('.modal-overlay')?.remove(),
  toggleModInManager: (event, el, fileName, disable) => toggleModInManager(fileName, disable),
  previewMod: (event, el, projectId) => previewMod(projectId),
  openModTranslateDialog: (event, el, fileName, modName) => openModTranslateDialog(fileName, modName),
  removeModFromManager: (event, el, fileName) => removeModFromManager(fileName),
});
