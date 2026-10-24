import { coreMethods } from './version-settings-methods-core.js';
import { modMethods } from './version-settings-methods-mods.js';
import { exportMethods } from './version-settings-methods-export.js';
import { vmHolders } from '../../core/vm-holders.js';
import { VERSION_SETTINGS_TEMPLATE } from './version-settings-template.js';
import VButton from '@/components/verse/VButton.vue';
import VInput from '@/components/verse/VInput.vue';
import VTextarea from '@/components/verse/VTextarea.vue';

const PageVersionSettings = {
  name: 'PageVersionSettings',
  // 模板里的通用控件使用 components/verse 语义层组件，此处统一注册
  components: { VButton, VInput, VTextarea },
  data() {
    return {
      versionId: null,
      title: '版本设置',
      // 版本信息
      customName: '',
      description: '',
      // 设置卡片
      isolation: 'global',
      windowTitle: '',
      customInfo: '',
      javaPath: 'global',
      javaOptions: [
        { value: 'global', text: '跟随全局设置' },
        { value: 'detect', text: '加载中...' }
      ],
      memoryMode: 'global',
      memoryValue: 4096,
      memOptimize: 'global',
      jvmArgs: '',
      gameArgs: '',
      usedMemory: '--',
      gameMemory: '--',
      // 外部版本提示
      isExternal: false,
      externalPath: '',
      // 面板
      activeTab: 'overview',
      // 模组卡片
      mods: [],
      modsLoading: false,
      modSearch: '',
      isVanilla: false,
      modsLoaded: false,
      // 存档卡片
      saves: [],
      savesLoading: false,
      savesLoaded: false,
      saveEditing: null,
      ruleDefs: {
        keepInventory: { label: '保留物品栏', def: false },
        doDaylightCycle: { label: '昼夜循环', def: true },
        doWeatherCycle: { label: '天气循环', def: true },
        doMobSpawning: { label: '生物生成', def: true },
        doMobLoot: { label: '生物掉落', def: true },
        doTileDrops: { label: '方块掉落', def: true },
        doEntityDrops: { label: '实体掉落', def: true },
        mobGriefing: { label: '生物破坏地形', def: true },
        naturalRegeneration: { label: '自然回血', def: true },
        doFireTick: { label: '火焰蔓延', def: true },
        pvp: { label: 'PVP 伤害', def: true },
        showCoordinates: { label: '显示坐标', def: false },
        commandBlockOutput: { label: '命令方块输出', def: true },
        randomTickSpeed: { label: '随机刻速度', def: '3' }
      },
      _saveIconCache: {},
      _saveIconLoading: {},
      // 导出卡片
      exportName: '',
      exportVersion: '1.0.0',
      exportAuthor: '',
      exportDescription: '',
      exportGameDesc: '正式版',
      exportModCount: '0 个',
      exportSavesCount: '',
      exportResourcePacks: [],
      exportSaves: [],
      exportSavesMore: 0,
      exportKeys: [],
      exportLoaded: false,
      exportTrees: {
        game: true, mods: true, resourcepacks: true, saves: true
      },
      // 其它
      checkingUpdates: false,
      repairSessionId: null,
      _memDisplayTimer: null
    };
  },
  computed: {
    displayName() {
      return this.customName || this.versionId || '';
    },
    memoryDisplayText() {
      return this.memoryValue + ' MB';
    },
    filteredMods() {
      const kw = (this.modSearch || '').toLowerCase();
      if (!kw) return this.mods;
      return this.mods.filter(m => {
        const name = (m.name || '').toLowerCase();
        const desc = (m.description || '').toLowerCase();
        return name.includes(kw) || desc.includes(kw);
      });
    },
    vanishPromptShown() {
      return this.activeTab === 'modmgr' && this.isVanilla;
    },
    boolRuleDefs() {
      const out = {};
      Object.keys(this.ruleDefs).forEach(k => {
        if (k !== 'randomTickSpeed') out[k] = this.ruleDefs[k];
      });
      return out;
    }
  },
  watch: {
    activeTab(val) {
      if (val === 'modmgr' && !this.isVanilla && !this.modsLoaded) {
        this.loadMods();
      } else if (val === 'export' && !this.exportLoaded) {
        this.loadExportTree();
      } else if (val === 'saves' && !this.savesLoaded) {
        this.loadSaves();
      }
    }
  },
  mounted() {
    vmHolders.versionSettings = this;
    this.initCustomSelects();
  },
  methods: {
    ...coreMethods,
    ...modMethods,
    ...exportMethods
  },
  template: VERSION_SETTINGS_TEMPLATE,
};

// 外部入口由 features/versions/version-settings.js 通过 vmHolders.versionSettings 调用本组件

export default PageVersionSettings;
