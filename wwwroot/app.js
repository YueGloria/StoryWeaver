(() => {
  'use strict';

  const Model = window.StoryModel;
  const Expr = window.StoryExpression;
  const $ = selector => document.querySelector(selector);
  const dom = {
    canvas: $('#canvas'), world: $('#world'), edgeLayer: $('#edge-layer'), nodeLayer: $('#node-layer'), sidebar: $('#sidebar'),
    projectTitle: $('#project-title'), saveStatus: $('#save-status'), selectionSummary: $('#selection-summary'), emptyState: $('#empty-state'),
    searchInput: $('#search-input'), searchResults: $('#search-results'), importFile: $('#import-file'),
    mergeTool: $('#merge-tool'), mergeDock: $('#merge-dock'), mergeMessage: $('#merge-message'), mergeCreate: $('#merge-create'),
    mergeExisting: $('#merge-existing'), connectTool: $('#connect-tool'), connectDock: $('#connect-dock'), connectMessage: $('#connect-message'),
    connectReset: $('#connect-reset'), insertStoryNode: $('#insert-story-node'), insertValueNode: $('#insert-value-node'), zoomLabel: $('#zoom-label'),
    nodeMoveTool: $('#node-move-tool'), resetNodePositions: $('#reset-node-positions'),
    notesToggle: $('#notes-toggle'), notesPosition: $('#notes-position'), themeTool: $('#theme-tool'), themePanel: $('#theme-panel'),
    dialogBackdrop: $('#dialog-backdrop'), dialogTitle: $('#dialog-title'), dialogMessage: $('#dialog-message'),
    dialogDetails: $('#dialog-details'), dialogIcon: $('#dialog-icon'), dialogCancel: $('#dialog-cancel'), dialogConfirm: $('#dialog-confirm'),
    toastRegion: $('#toast-region')
  };

  let project = Model.createDefaultProject();
  let calculation = Model.calculate(project);
  let layout = Model.layoutGraph(project);
  let edgeRoutes = Model.routeBranchLines(project, layout);
  let selection = { type: 'node', id: project.rootId };
  let dirty = false;
  let loaded = false;
  let firstFit = true;
  let dialogCallback = null;
  let searchActiveIndex = -1;
  let expressionTimer = null;
  let webMcpRegistered = false;
  const webMcpLifecycle = new AbortController();
  const view = {
    x: 40, y: 20, scale: 1,
    dragging: false, pointerId: null, startX: 0, startY: 0, lastX: 0, lastY: 0,
    suppressClick: false
  };
  const mergeState = { active: false, sources: new Set(), selectingTarget: false };
  const connectState = { active: false, sourceId: null };
  const routeEditState = { lineId: null, pointIndex: null, drag: null };
  const nodeMoveState = { active: false, drag: null };
  let hoveredNodeId = null;
  let customThemePresets = [];

  const THEME_PRESETS = {
    midnight: {
      name: '午夜蓝', colors: {
        background: '#090E17', panel: '#111827', surface: '#172033', canvas: '#0A101A', grid: '#7C91BC', text: '#EFF3FB', muted: '#94A2BA', accent: '#748CFF',
        storyNode: '#151F31', storyBorder: '#35445E', rootNode: '#202E50', rootBorder: '#50669A', valueNode: '#142A27', valueBorder: '#356458',
        branchLine: '#52627D', branchSelected: '#91A3FF', noteBackground: '#182235', noteBorder: '#475A78', noteText: '#DCE4F3'
      }
    },
    paper: {
      name: '纸页白', colors: {
        background: '#E9E5DC', panel: '#F7F4EC', surface: '#EEE9DF', canvas: '#F4F0E8', grid: '#A59F92', text: '#272B33', muted: '#66707D', accent: '#4669B2',
        storyNode: '#FFFDF7', storyBorder: '#A8A095', rootNode: '#E4EAF7', rootBorder: '#7389B8', valueNode: '#E6F1EB', valueBorder: '#6A9B82',
        branchLine: '#777A80', branchSelected: '#355DA9', noteBackground: '#FFF8D9', noteBorder: '#BAA968', noteText: '#3F3A2C'
      }
    },
    ember: {
      name: '暖焰', colors: {
        background: '#18100F', panel: '#241716', surface: '#33201D', canvas: '#130E0D', grid: '#A56E5F', text: '#FFF1E8', muted: '#C2A49A', accent: '#E67E56',
        storyNode: '#2D1C1A', storyBorder: '#75463B', rootNode: '#49251F', rootBorder: '#A95F4A', valueNode: '#263023', valueBorder: '#637F55',
        branchLine: '#91675C', branchSelected: '#FFAA7C', noteBackground: '#38231E', noteBorder: '#8E5B49', noteText: '#FFE4D5'
      }
    },
    forest: {
      name: '苔林', colors: {
        background: '#09130F', panel: '#102019', surface: '#172C23', canvas: '#081510', grid: '#5D8B73', text: '#E9F6EE', muted: '#93B2A1', accent: '#69B58D',
        storyNode: '#14271F', storyBorder: '#345D49', rootNode: '#1D3A2E', rootBorder: '#4B8067', valueNode: '#17312C', valueBorder: '#3B796A',
        branchLine: '#557A67', branchSelected: '#8FE0B6', noteBackground: '#193027', noteBorder: '#4B735F', noteText: '#DDF5E7'
      }
    },
    contrast: {
      name: '高对比', colors: {
        background: '#000000', panel: '#0B0B0B', surface: '#171717', canvas: '#000000', grid: '#5A5A5A', text: '#FFFFFF', muted: '#D0D0D0', accent: '#FFD400',
        storyNode: '#101010', storyBorder: '#FFFFFF', rootNode: '#17132B', rootBorder: '#C7B8FF', valueNode: '#071E16', valueBorder: '#78FFC4',
        branchLine: '#E5E5E5', branchSelected: '#FFD400', noteBackground: '#171717', noteBorder: '#FFFFFF', noteText: '#FFFFFF'
      }
    },
    mist: {
      name: '冷雾蓝', colors: {
        background: '#DCE6EF', panel: '#F3F7FA', surface: '#E4EDF4', canvas: '#EEF4F8', grid: '#96ABBC', text: '#24313E', muted: '#5E7183', accent: '#4D79A8',
        storyNode: '#F9FCFE', storyBorder: '#91A9BD', rootNode: '#DCE9F5', rootBorder: '#648BAD', valueNode: '#E1F2EF', valueBorder: '#5F9D91',
        branchLine: '#72889A', branchSelected: '#285E91', noteBackground: '#FFFBE9', noteBorder: '#B6A86B', noteText: '#3F4A53'
      }
    },
    cream: {
      name: '暖米纸', colors: {
        background: '#E9E0D2', panel: '#FBF6EC', surface: '#F0E6D7', canvas: '#F7F1E6', grid: '#AB9C87', text: '#352D26', muted: '#716455', accent: '#9B653F',
        storyNode: '#FFFDF8', storyBorder: '#B8A790', rootNode: '#F2E0C8', rootBorder: '#A97852', valueNode: '#E8F0E4', valueBorder: '#76966A',
        branchLine: '#827568', branchSelected: '#8B4D2B', noteBackground: '#FFF4C9', noteBorder: '#B89A4D', noteText: '#4A3C2C'
      }
    },
    mint: {
      name: '淡薄荷', colors: {
        background: '#DFECE8', panel: '#F5FAF7', surface: '#E6F1EC', canvas: '#EFF7F3', grid: '#91AEA4', text: '#253832', muted: '#5E756E', accent: '#397F70',
        storyNode: '#FBFEFC', storyBorder: '#91B2A7', rootNode: '#D9ECE5', rootBorder: '#60988A', valueNode: '#E5F2DB', valueBorder: '#769B62',
        branchLine: '#69877D', branchSelected: '#286C5D', noteBackground: '#FFF7D9', noteBorder: '#B5A266', noteText: '#3A4A43'
      }
    },
    rose: {
      name: '柔和灰粉', colors: {
        background: '#EDE3E6', panel: '#FBF7F8', surface: '#F0E7EA', canvas: '#F7F1F3', grid: '#B29EA5', text: '#3B2D32', muted: '#78636B', accent: '#9B5F75',
        storyNode: '#FFFCFD', storyBorder: '#BDA4AD', rootNode: '#F1DDE5', rootBorder: '#A66F83', valueNode: '#E7EFE8', valueBorder: '#78947E',
        branchLine: '#89747C', branchSelected: '#85465E', noteBackground: '#FFF3D9', noteBorder: '#B99B60', noteText: '#4B3B41'
      }
    }
  };
  const THEME_BRANCH_PALETTES = {
    midnight: ['#7FA3FF', '#50C8B0', '#E39A62', '#C28AE8', '#E66F82', '#72BFE8', '#B4C85F', '#D5A6CC'],
    paper: ['#386CB0', '#2F8A73', '#B2622B', '#8751A8', '#B64C64', '#287E9B', '#71852D', '#9A687E'],
    ember: ['#FF9C73', '#7ED3B1', '#E3C15D', '#CA91E8', '#F06F8C', '#6FB6E8', '#A8CA6A', '#D89BAE'],
    forest: ['#77CAA0', '#69B8D0', '#D7B969', '#B48AD7', '#DE7C8C', '#8FAA5B', '#D29162', '#86B0E4'],
    contrast: ['#00E5FF', '#FFD400', '#75FF9B', '#FF78D1', '#FF8B3D', '#A88CFF', '#FFFFFF', '#7AC7FF'],
    mist: ['#376FA5', '#2E887C', '#B66A36', '#8055A8', '#B34E6B', '#2B829A', '#74893A', '#98667C'],
    cream: ['#446E9E', '#4F846D', '#A76537', '#825E9D', '#A85265', '#3B7F90', '#778B3D', '#956B76'],
    mint: ['#367A6D', '#4B72A0', '#AA673A', '#7D5AA0', '#AE536B', '#347E91', '#718A3A', '#936779'],
    rose: ['#8F5068', '#397D73', '#A96637', '#715FA4', '#B34E59', '#397C99', '#73873B', '#8F687B']
  };
  Object.entries(THEME_PRESETS).forEach(([id, preset]) => {
    (THEME_BRANCH_PALETTES[id] || THEME_BRANCH_PALETTES.midnight).forEach((color, index) => {
      preset.colors[`branchPalette${index + 1}`] = color;
    });
  });
  const THEME_FIELDS = [
    ['background', '页面背景'], ['panel', '顶栏与侧栏'], ['surface', '控件表面'], ['canvas', '画布背景'], ['grid', '画布网格'], ['text', '主要文字'], ['muted', '次要文字'], ['accent', '强调色'],
    ['storyNode', '剧情节点'], ['storyBorder', '剧情边框'], ['rootNode', '元节点'], ['rootBorder', '元节点边框'], ['valueNode', '数值节点'], ['valueBorder', '数值边框'],
    ['branchLine', '统一分支线'], ['branchSelected', '选中分支线'], ['noteBackground', '备注背景'], ['noteBorder', '备注边框'], ['noteText', '备注文字'],
    ['branchPalette1', '分组色 1'], ['branchPalette2', '分组色 2'], ['branchPalette3', '分组色 3'], ['branchPalette4', '分组色 4'],
    ['branchPalette5', '分组色 5'], ['branchPalette6', '分组色 6'], ['branchPalette7', '分组色 7'], ['branchPalette8', '分组色 8']
  ];

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
  }

  function escapeXml(value) { return escapeHtml(value).replace(/'/g, '&apos;'); }
  function ensureViewSettings() {
    project.viewSettings = Model.normalizeViewSettings(project.viewSettings);
    return project.viewSettings;
  }

  function hexRgb(hex) {
    const value = String(hex || '#000000').replace('#', '');
    return {
      r: parseInt(value.slice(0, 2), 16) || 0,
      g: parseInt(value.slice(2, 4), 16) || 0,
      b: parseInt(value.slice(4, 6), 16) || 0
    };
  }

  function rgba(hex, alpha) {
    const { r, g, b } = hexRgb(hex);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function mixHex(first, second, ratio = .5) {
    const a = hexRgb(first);
    const b = hexRgb(second);
    const channel = key => Math.round(a[key] * (1 - ratio) + b[key] * ratio).toString(16).padStart(2, '0');
    return `#${channel('r')}${channel('g')}${channel('b')}`.toUpperCase();
  }

  function colorLuminance(hex) {
    const rgb = hexRgb(hex);
    const channel = value => {
      const normalized = value / 255;
      return normalized <= .03928 ? normalized / 12.92 : ((normalized + .055) / 1.055) ** 2.4;
    };
    return channel(rgb.r) * .2126 + channel(rgb.g) * .7152 + channel(rgb.b) * .0722;
  }

  function contrastRatio(first, second) {
    const a = colorLuminance(first);
    const b = colorLuminance(second);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
  }

  function resolvedThemeColors() {
    const settings = ensureViewSettings().theme;
    if (settings.preset === 'custom') return { ...THEME_PRESETS.midnight.colors, ...settings.colors };
    return { ...(THEME_PRESETS[settings.preset] || THEME_PRESETS.midnight).colors };
  }

  function applyTheme() {
    const colors = resolvedThemeColors();
    const root = document.documentElement;
    const variables = {
      '--bg': colors.background,
      '--panel': colors.panel,
      '--panel-deep': mixHex(colors.panel, colors.background, .46),
      '--surface': colors.surface,
      '--surface-raised': mixHex(colors.surface, colors.text, .1),
      '--line': mixHex(colors.surface, colors.text, .2),
      '--line-strong': mixHex(colors.surface, colors.text, .34),
      '--text': colors.text,
      '--muted': colors.muted,
      '--subtle': mixHex(colors.muted, colors.background, .32),
      '--accent': colors.accent,
      '--accent-strong': mixHex(colors.accent, colors.background, .12),
      '--accent-soft': rgba(colors.accent, .16),
      '--accent-contrast': colorLuminance(colors.accent) > .46 ? '#11151D' : '#FFFFFF',
      '--canvas-bg': colors.canvas,
      '--grid-dot': rgba(colors.grid, .3),
      '--story-node-bg': colors.storyNode,
      '--story-node-border': colors.storyBorder,
      '--root-node-bg': colors.rootNode,
      '--root-node-border': colors.rootBorder,
      '--value-node-bg': colors.valueNode,
      '--value-node-border': colors.valueBorder,
      '--branch-line': colors.branchLine,
      '--branch-selected': colors.branchSelected,
      '--note-bg': colors.noteBackground,
      '--note-border': colors.noteBorder,
      '--note-text': colors.noteText,
      '--mint': colors.valueBorder,
      '--mint-soft': rgba(colors.valueBorder, .15)
    };
    for (let index = 1; index <= 8; index += 1) variables[`--branch-palette-${index - 1}`] = colors[`branchPalette${index}`];
    Object.entries(variables).forEach(([name, value]) => root.style.setProperty(name, value));
    root.style.colorScheme = colorLuminance(colors.background) > .48 ? 'light' : 'dark';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', colors.panel);
  }

  function themeContrastSummary() {
    const colors = resolvedThemeColors();
    const checks = [
      ['主要文字与侧栏', colors.text, colors.panel, 4.5],
      ['主要文字与剧情节点', colors.text, colors.storyNode, 4.5],
      ['备注文字与备注背景', colors.noteText, colors.noteBackground, 4.5],
      ['分支线与画布', colors.branchLine, colors.canvas, 3]
    ];
    return checks.filter(([, foreground, background, minimum]) => contrastRatio(foreground, background) < minimum).map(([label]) => label);
  }

  function updateThemeContrast() {
    const warning = dom.themePanel.querySelector('#theme-contrast');
    if (!warning) return;
    const failures = themeContrastSummary();
    warning.className = `theme-contrast${failures.length ? ' warning' : ''}`;
    warning.textContent = failures.length ? `对比度提醒：${failures.join('、')}可能不够清晰。` : '文字与主要界面的对比度良好。';
  }

  function themeSwatches(colors) {
    return [colors.canvas, colors.storyNode, colors.accent, colors.branchPalette1, colors.branchPalette2]
      .map(color => `<i style="background:${color}"></i>`).join('');
  }

  function sameThemeColors(first, second) {
    return THEME_FIELDS.every(([key]) => String(first?.[key] || '').toUpperCase() === String(second?.[key] || '').toUpperCase());
  }

  function renderThemePanel() {
    const viewSettings = ensureViewSettings();
    const settings = viewSettings.theme;
    const colors = resolvedThemeColors();
    const customCards = customThemePresets.length ? customThemePresets.map(preset => {
      const active = settings.preset === 'custom' && settings.savedPresetId === preset.id;
      const modified = active && !sameThemeColors(colors, preset.colors);
      return `<div class="saved-theme-card${active ? ' active' : ''}" data-saved-theme-card="${escapeHtml(preset.id)}">
        <button type="button" class="saved-theme-apply" data-saved-theme-apply="${escapeHtml(preset.id)}">
          <span class="theme-swatches">${themeSwatches(preset.colors)}</span><span><strong>${escapeHtml(preset.name)}</strong><small>${modified ? '当前项目有未保存修改' : '自定义方案'}</small></span>
        </button>
        <div class="saved-theme-actions"><button type="button" class="mini-button" data-saved-theme-update="${escapeHtml(preset.id)}">更新</button><button type="button" class="remove-row" data-saved-theme-delete="${escapeHtml(preset.id)}" aria-label="删除${escapeHtml(preset.name)}">×</button></div>
      </div>`;
    }).join('') : '<div class="theme-library-empty">还没有保存的自定义方案。调整下方颜色后，可在这里命名保存。</div>';
    dom.themePanel.innerHTML = `<div class="theme-panel-head"><div><span class="eyebrow">外观</span><h2>主题与颜色</h2></div><button type="button" class="icon-button" data-theme-action="close" aria-label="关闭主题面板">×</button></div>
      <p class="theme-panel-copy">主题只改变显示，不影响剧情与数值逻辑。自定义方案保存在软件旁的 cache 文件夹，可供不同项目复用。</p>
      <label class="switch-row theme-branch-switch"><span class="switch-copy"><strong>分支线分组色板</strong><span>开启后，同一节点的所有出线同色；相邻或交叠的来源尽量错色</span></span><span class="switch"><input id="branch-colors-enabled" type="checkbox"${viewSettings.branchColors.enabled ? ' checked' : ''}><span class="switch-track"></span></span></label>
      <h3 class="theme-section-title">内置方案</h3>
      <div class="theme-presets">${Object.entries(THEME_PRESETS).map(([id, preset]) => `<button type="button" class="theme-preset${settings.preset === id ? ' active' : ''}" data-theme-preset="${id}"><span class="theme-swatches">${themeSwatches(preset.colors)}</span><strong>${preset.name}</strong></button>`).join('')}</div>
      <div class="theme-custom-head"><div><h3>我的主题方案</h3><p>可保存、更新或删除；内置方案不会被改动</p></div></div>
      <div class="theme-save-row"><input id="theme-preset-name" class="compact-input" maxlength="40" placeholder="给当前配色命名"><button type="button" class="mini-button accent" data-theme-action="save-preset">保存为方案</button></div>
      <div class="saved-theme-list">${customCards}</div>
      <div class="theme-custom-head"><div><h3>自定义各部分颜色</h3><p>当前值会直接在画布上预览</p></div><button type="button" class="mini-button" data-theme-action="reset">恢复午夜蓝</button></div>
      <div class="theme-color-grid">${THEME_FIELDS.map(([key, label]) => `<label class="theme-color-field"><span>${label}</span><span class="theme-color-control"><input type="color" value="${colors[key]}" data-theme-color="${key}" aria-label="${label}"><code data-theme-code="${key}">${colors[key]}</code></span></label>`).join('')}</div>
      <div id="theme-contrast" class="theme-contrast"></div>`;
    updateThemeContrast();
  }

  function setThemePreset(preset) {
    if (!THEME_PRESETS[preset]) return;
    ensureViewSettings().theme = { preset, savedPresetId: '', colors: {} };
    applyTheme();
    markDirty();
    renderThemePanel();
    renderGraph();
  }

  function setSavedThemePreset(presetId) {
    const preset = customThemePresets.find(item => item.id === presetId);
    if (!preset) return;
    ensureViewSettings().theme = { preset: 'custom', savedPresetId: preset.id, colors: { ...preset.colors } };
    applyTheme();
    markDirty();
    renderThemePanel();
    renderGraph();
  }

  function setCustomThemeColor(key, value) {
    if (!THEME_FIELDS.some(([field]) => field === key) || !/^#[0-9a-f]{6}$/i.test(value)) return;
    const currentTheme = ensureViewSettings().theme;
    const colors = resolvedThemeColors();
    colors[key] = value.toUpperCase();
    ensureViewSettings().theme = { preset: 'custom', savedPresetId: currentTheme.savedPresetId || '', colors };
    applyTheme();
    markDirty();
    dom.themePanel.querySelector(`[data-theme-code="${CSS.escape(key)}"]`)?.replaceChildren(value.toUpperCase());
    dom.themePanel.querySelectorAll('[data-theme-preset]').forEach(button => button.classList.remove('active'));
    const state = dom.themePanel.querySelector(`[data-saved-theme-card="${CSS.escape(currentTheme.savedPresetId || '')}"] small`);
    if (state) state.textContent = '当前项目有未保存修改';
    updateThemeContrast();
  }

  function setBranchColorMode(enabled) {
    ensureViewSettings().branchColors.enabled = Boolean(enabled);
    markDirty();
    renderGraph();
  }

  function normalizeThemePresetRecord(raw) {
    if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string' || !raw.colors || typeof raw.colors !== 'object') return null;
    const colors = { ...THEME_PRESETS.midnight.colors };
    THEME_FIELDS.forEach(([key]) => {
      if (/^#[0-9a-f]{6}$/i.test(raw.colors[key] || '')) colors[key] = String(raw.colors[key]).toUpperCase();
    });
    return { id: raw.id, name: raw.name, colors };
  }

  async function loadThemePresets() {
    try {
      const response = await fetch('/api/theme-presets', { cache: 'no-store' });
      if (!response.ok) throw new Error(`读取主题方案失败（${response.status}）`);
      const records = await response.json();
      customThemePresets = Array.isArray(records) ? records.map(normalizeThemePresetRecord).filter(Boolean) : [];
    } catch (error) {
      customThemePresets = [];
      console.warn(error);
    }
  }

  async function persistThemePreset(id, name) {
    const response = await fetch('/api/theme-presets/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: id || '', name, colors: resolvedThemeColors() })
    });
    if (!response.ok) throw new Error((await response.text()) || `保存主题方案失败（${response.status}）`);
    const saved = normalizeThemePresetRecord(await response.json());
    if (!saved) throw new Error('主题方案返回格式无效。');
    await loadThemePresets();
    ensureViewSettings().theme = { preset: 'custom', savedPresetId: saved.id, colors: { ...saved.colors } };
    applyTheme();
    markDirty();
    renderThemePanel();
    renderGraph();
    toast(id ? `已更新主题方案“${saved.name}”。` : `已保存主题方案“${saved.name}”。`);
  }

  function saveNamedThemePreset() {
    const input = dom.themePanel.querySelector('#theme-preset-name');
    const name = input?.value.trim() || '';
    if (!name) return toast('请先填写主题方案名称。', 'error');
    const existing = customThemePresets.find(item => item.name.localeCompare(name, 'zh-CN', { sensitivity: 'accent' }) === 0);
    const execute = () => void persistThemePreset(existing?.id || '', name).catch(error => toast(error.message || '保存主题方案失败。', 'error'));
    if (!existing) return execute();
    showDialog({
      title: '覆盖同名主题方案',
      message: `已经有一个名为“${name}”的自定义方案。是否用当前颜色覆盖它？`,
      confirmLabel: '覆盖方案', onConfirm: execute
    });
  }

  function updateSavedThemePreset(presetId) {
    const preset = customThemePresets.find(item => item.id === presetId);
    if (!preset) return;
    void persistThemePreset(preset.id, preset.name).catch(error => toast(error.message || '更新主题方案失败。', 'error'));
  }

  function deleteSavedThemePreset(presetId) {
    const preset = customThemePresets.find(item => item.id === presetId);
    if (!preset) return;
    showDialog({
      title: '删除自定义主题方案',
      message: `确定删除“${preset.name}”吗？当前项目已经保存的颜色不会改变，但以后不能再从方案列表直接套用。`,
      confirmLabel: '删除方案',
      onConfirm: async () => {
        try {
          const response = await fetch('/api/theme-presets/delete', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: preset.id })
          });
          if (!response.ok) throw new Error((await response.text()) || `删除失败（${response.status}）`);
          if (ensureViewSettings().theme.savedPresetId === preset.id) {
            ensureViewSettings().theme.savedPresetId = '';
            markDirty();
          }
          await loadThemePresets();
          renderThemePanel();
          toast(`已删除主题方案“${preset.name}”。`);
        } catch (error) {
          toast(error.message || '删除主题方案失败。', 'error');
        }
      }
    });
  }

  function selectedNode() { return selection.type === 'node' ? Model.getNode(project, selection.id) : null; }
  function selectedLine() { return selection.type === 'line' ? Model.getLine(project, selection.id) : null; }
  function defaultVariableId() { return project.numberDefinitions[0]?.id || ''; }
  function optionList(items, selectedValue, label, value = 'id') {
    return items.map(item => `<option value="${escapeHtml(item[value])}"${item[value] === selectedValue ? ' selected' : ''}>${escapeHtml(item[label])}</option>`).join('');
  }
  function groupedDefinitionOptions(selectedValue) {
    return Model.numberDefinitionSections(project).map(section => `<optgroup label="${escapeHtml(section.name)}">${optionList(section.definitions, selectedValue, 'name')}</optgroup>`).join('');
  }
  function numberGroupOptions(selectedGroupId) {
    const groups = Array.isArray(project.numberGroups) ? project.numberGroups : [];
    return `<option value=""${selectedGroupId ? '' : ' selected'}>未分组</option>${groups.map(group => `<option value="${escapeHtml(group.id)}"${group.id === selectedGroupId ? ' selected' : ''}>${escapeHtml(group.name)}</option>`).join('')}`;
  }
  function capText(text, length = 16) { return text.length > length ? `${text.slice(0, length - 1)}…` : text; }
  function formatCount(value) { return value >= Number.MAX_SAFE_INTEGER ? '很多' : new Intl.NumberFormat('zh-CN').format(value || 0); }

  function setSaveStatus(text, mode = '') {
    dom.saveStatus.textContent = text;
    dom.saveStatus.className = mode;
  }

  function markDirty() {
    dirty = true;
    project.meta.updatedAt = Model.nowIso();
    setSaveStatus('有未保存更改', 'unsaved');
  }

  function toast(message, type = '') {
    const item = document.createElement('div');
    item.className = `toast ${type}`.trim();
    item.textContent = message;
    dom.toastRegion.appendChild(item);
    setTimeout(() => item.remove(), 3600);
  }

  function showDialog(options) {
    dom.dialogTitle.textContent = options.title || '请确认';
    dom.dialogMessage.textContent = options.message || '';
    dom.dialogIcon.textContent = options.icon || '!';
    dom.dialogDetails.hidden = !options.details && !options.detailsHtml;
    if (options.detailsHtml) dom.dialogDetails.innerHTML = options.detailsHtml;
    else dom.dialogDetails.textContent = options.details || '';
    dom.dialogCancel.hidden = options.cancelVisible === false;
    dom.dialogCancel.textContent = options.cancelLabel || '取消';
    dom.dialogConfirm.textContent = options.confirmLabel || '确认';
    dom.dialogConfirm.className = options.danger === false ? 'primary-button' : 'danger-button';
    dialogCallback = typeof options.onConfirm === 'function' ? options.onConfirm : null;
    dom.dialogBackdrop.hidden = false;
    requestAnimationFrame(() => dom.dialogConfirm.focus());
  }

  function closeDialog(runCallback = false) {
    const callback = dialogCallback;
    dialogCallback = null;
    dom.dialogBackdrop.hidden = true;
    if (runCallback && callback) callback();
  }

  function refresh({ sidebar = true, graph = true } = {}) {
    const validNodeIds = new Set(project.nodes.map(node => node.id));
    const settings = ensureViewSettings();
    settings.nodeOffsets = Object.fromEntries(Object.entries(settings.nodeOffsets).filter(([nodeId]) => validNodeIds.has(nodeId)));
    calculation = Model.calculate(project);
    layout = Model.layoutGraph(project);
    edgeRoutes = Model.routeBranchLines(project, layout);
    if (graph) renderGraph();
    if (sidebar) renderSidebar();
    updateToolbar();
  }

  function applyView() {
    dom.world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    dom.zoomLabel.textContent = `${Math.round(view.scale * 100)}%`;
  }

  function zoomAt(clientX, clientY, nextScale) {
    const bounds = dom.canvas.getBoundingClientRect();
    const localX = clientX - bounds.left;
    const localY = clientY - bounds.top;
    const worldX = (localX - view.x) / view.scale;
    const worldY = (localY - view.y) / view.scale;
    view.scale = Math.min(2.2, Math.max(.28, nextScale));
    view.x = localX - worldX * view.scale;
    view.y = localY - worldY * view.scale;
    applyView();
  }

  function fitView() {
    const bounds = dom.canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const padding = 70;
    view.scale = Math.min(1.05, Math.max(.28, Math.min((bounds.width - padding * 2) / layout.width, (bounds.height - padding * 2) / layout.height)));
    view.x = Math.max(24, (bounds.width - layout.width * view.scale) / 2);
    view.y = (bounds.height - layout.height * view.scale) / 2;
    applyView();
  }

  function focusNode(nodeId) {
    const position = layout.positions.get(nodeId);
    if (!position) return;
    const bounds = dom.canvas.getBoundingClientRect();
    const targetScale = Math.max(.62, view.scale);
    view.scale = targetScale;
    view.x = bounds.width / 2 - (position.x + position.width / 2) * targetScale;
    view.y = bounds.height / 2 - (position.y + position.height / 2) * targetScale;
    applyView();
  }

  function nodeValueMarkup(node) {
    const result = calculation.nodeResults.get(node.id);
    if (!result?.reachable) return '<span class="node-value-chip unreachable">当前不可达</span>';
    if (node.kind === 'value') {
      const options = Model.getValueOptions(node);
      if (!options.length) return '<span class="node-value-chip value-option-chip">未设置选项 · 数值不变</span>';
      const firstName = options[0]?.name || '未命名选项';
      const preview = options.length > 1 ? `${firstName} 等` : firstName;
      return `<span class="node-value-chip value-option-count">${options.length} 个选项</span><span class="node-value-chip value-option-chip" title="${escapeHtml(options.map(option => option.name || '未命名选项').join('、'))}">${escapeHtml(preview)}</span>`;
    }
    if (!project.numberDefinitions.length) return '<span class="node-value-chip">尚未定义数值</span>';
    const shown = project.numberDefinitions.slice(0, 2).map(definition =>
      `<span class="node-value-chip">${escapeHtml(definition.name)} ${escapeHtml(Model.formatRange(result.values[definition.id]))}</span>`).join('');
    const remainder = project.numberDefinitions.length > 2 ? `<span class="node-value-chip">+${project.numberDefinitions.length - 2}</span>` : '';
    return shown + remainder;
  }

  function edgePath(source, target) {
    const startX = source.x + source.width;
    const startY = source.y + source.height / 2;
    const endX = target.x;
    const endY = target.y + target.height / 2;
    const gap = Math.max(80, endX - startX);
    const control = Math.min(130, gap * .44);
    return {
      d: `M ${startX} ${startY} C ${startX + control} ${startY}, ${endX - control} ${endY}, ${endX} ${endY}`,
      startX, startY, endX, endY, midX: (startX + endX) / 2, midY: (startY + endY) / 2
    };
  }

  function applyNodeEdgeHighlight() {
    const activeNodeId = hoveredNodeId && Model.getNode(project, hoveredNodeId) ? hoveredNodeId : null;
    const groups = [...dom.edgeLayer.querySelectorAll('.edge-group')];
    dom.edgeLayer.classList.toggle('node-hovering', Boolean(activeNodeId));
    groups.forEach(group => {
      const related = Boolean(activeNodeId) && (group.dataset.sourceId === activeNodeId || group.dataset.targetId === activeNodeId);
      group.classList.toggle('node-related', related);
    });
    if (activeNodeId) groups.filter(group => group.classList.contains('node-related')).forEach(group => dom.edgeLayer.append(group));
    groups.filter(group => group.classList.contains('selected') || group.classList.contains('editing')).forEach(group => dom.edgeLayer.append(group));
  }

  function setHoveredNode(nodeId) {
    const normalized = nodeId && Model.getNode(project, nodeId) ? nodeId : null;
    if (hoveredNodeId === normalized) return;
    hoveredNodeId = normalized;
    applyNodeEdgeHighlight();
  }

  function renderGraph() {
    if (routeEditState.lineId && (selection.type !== 'line' || selection.id !== routeEditState.lineId)) {
      routeEditState.lineId = null;
      routeEditState.pointIndex = null;
      routeEditState.drag = null;
    }
    edgeRoutes = Model.routeBranchLines(project, layout);
    const viewSettings = ensureViewSettings();
    const branchColorSlots = viewSettings.branchColors.enabled
      ? Model.assignBranchColorSlots(project, layout, edgeRoutes, 8)
      : new Map();
    dom.world.style.width = `${layout.width}px`;
    dom.world.style.height = `${layout.height}px`;
    dom.edgeLayer.setAttribute('width', layout.width);
    dom.edgeLayer.setAttribute('height', layout.height);
    dom.edgeLayer.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);

    dom.edgeLayer.classList.toggle('has-selection', selection.type === 'line');
    dom.edgeLayer.classList.toggle('route-editing', Boolean(routeEditState.lineId));
    const linesForRender = [...project.branchLines].sort((first, second) =>
      Number(selection.type === 'line' && selection.id === first.id) - Number(selection.type === 'line' && selection.id === second.id));
    dom.edgeLayer.innerHTML = linesForRender.map(line => {
      const source = layout.positions.get(line.sourceId);
      const target = layout.positions.get(line.targetId);
      if (!source || !target) return '';
      const geometry = edgeRoutes.get(line.id);
      if (!geometry) return '';
      const isSelected = selection.type === 'line' && selection.id === line.id;
      const isEditing = routeEditState.lineId === line.id && line.route?.mode === 'manual';
      const colorSlot = branchColorSlots.get(line.sourceId) ?? 0;
      const edgeColor = viewSettings.branchColors.enabled ? `var(--branch-palette-${colorSlot})` : 'var(--branch-line)';
      const label = line.label.trim();
      const visibleLabel = label || (isSelected ? '未命名分支线' : '');
      const labelWidth = Model.edgeLabelWidth(visibleLabel);
      const labelY = geometry.labelY - 16;
      const handles = isEditing ? (line.route?.points || []).map((point, index) => `<g class="route-handle-wrap${routeEditState.pointIndex === index ? ' selected' : ''}" data-route-handle="${index}" transform="translate(${point.x} ${point.y})"><circle class="route-handle-halo" r="12"></circle><circle class="route-handle" r="6"></circle></g>`).join('') : '';
      return `<g class="edge-group${isSelected ? ' selected' : ''}${isEditing ? ' editing' : ''}${line.lock?.enabled ? ' locked' : ''}" data-edge-id="${escapeHtml(line.id)}" data-source-id="${escapeHtml(line.sourceId)}" data-target-id="${escapeHtml(line.targetId)}" data-color-slot="${colorSlot}" style="--edge-color:${edgeColor}">
        <path class="edge-line" d="${geometry.d}"></path>
        <polygon class="edge-arrow" points="${geometry.endX - 9},${geometry.endY - 5} ${geometry.endX},${geometry.endY} ${geometry.endX - 9},${geometry.endY + 5}"></polygon>
        <path class="edge-hit" data-edge-action="select" d="${geometry.d}"></path>
        ${visibleLabel ? `<g class="edge-label-wrap" data-edge-action="select">
          <rect class="edge-label-bg" x="${geometry.labelX - labelWidth / 2}" y="${labelY - 12}" width="${labelWidth}" height="24" rx="7"></rect>
          <text class="edge-label" x="${geometry.labelX}" y="${labelY}">${escapeXml(visibleLabel)}</text>
        </g>` : ''}
        <g class="edge-delete" data-edge-action="delete" transform="translate(${geometry.deleteX} ${geometry.deleteY})">
          <circle r="10"></circle><text y="1">−</text>
        </g>
        ${handles}
      </g>`;
    }).join('');

    dom.nodeLayer.innerHTML = project.nodes.map(node => {
      const position = layout.positions.get(node.id);
      const result = calculation.nodeResults.get(node.id);
      const classes = ['story-node'];
      if (node.kind === 'root') classes.push('root-node');
      if (node.kind === 'value') classes.push('value-node');
      if (selection.type === 'node' && selection.id === node.id) classes.push('selected');
      if (mergeState.sources.has(node.id)) classes.push('merge-source');
      if (mergeState.active && mergeState.selectingTarget) classes.push('merge-target-candidate');
      if (connectState.sourceId === node.id) classes.push('connect-source');
      if (connectState.active && node.kind === 'story') classes.push(connectState.sourceId ? 'connect-target-candidate' : 'connect-source-candidate');
      if (connectState.active && node.kind !== 'story') classes.push('connect-ineligible');
      if (result?.structuralReachable && !result.reachable) classes.push('unreachable');
      const offset = viewSettings.nodeOffsets[node.id];
      if (offset && (offset.x || offset.y)) classes.push('manually-positioned');
      if (nodeMoveState.active) classes.push('node-move-candidate');
      if (nodeMoveState.drag?.nodeId === node.id) classes.push('node-dragging');
      const kindLabel = node.kind === 'root' ? '元节点' : node.kind === 'value' ? '数值节点' : '剧情节点';
      const pathLabel = result?.reachable ? `${formatCount(result.pathCount)} 条路径` : '不可进入';
      const connectHint = connectState.active && node.kind === 'story' ? `，点击设为连线${connectState.sourceId ? '终点' : '起点'}` : '';
      const noteBox = layout.noteBoxes?.get(node.id);
      const noteMarkup = noteBox ? `<aside class="canvas-note note-${noteBox.position}" style="left:${noteBox.x}px;top:${noteBox.y}px;width:${noteBox.width}px;height:${noteBox.height}px" aria-label="${escapeHtml(node.title || '未命名节点')}的备注" title="${escapeHtml(node.notes)}"><span>备注</span><p>${escapeHtml(node.notes)}</p></aside>` : '';
      const moveHint = nodeMoveState.active ? '，可拖动调整位置' : '';
      return `<article class="${classes.join(' ')}" data-node-id="${escapeHtml(node.id)}" style="left:${position.x}px;top:${position.y}px;width:${position.width}px;min-height:${position.height}px" tabindex="0" aria-label="${escapeHtml(kindLabel)}：${escapeHtml(node.title || '未命名')}${connectHint}${moveHint}">
        <span class="node-kicker"><span>${kindLabel}</span><span class="route-count">${pathLabel}</span></span>
        <strong>${escapeHtml(node.title.trim() || '未命名节点')}</strong>
        <div class="node-values">${nodeValueMarkup(node)}</div>
        <button type="button" class="node-add" data-node-action="add" aria-label="为${escapeHtml(node.title || '此节点')}添加子节点">＋</button>
      </article>${noteMarkup}`;
    }).join('');

    dom.canvas.classList.toggle('node-move-mode', nodeMoveState.active);
    applyNodeEdgeHighlight();
    dom.emptyState.hidden = project.nodes.length > 1;
    updateMergeDock();
    updateConnectDock();
    applyView();
  }

  function valueListMarkup(nodeId) {
    const result = calculation.nodeResults.get(nodeId);
    if (!project.numberDefinitions.length) return '<div class="empty-inline">还没有数值类。请在元节点的“数值定义”中添加。</div>';
    if (!result?.reachable) return '<div class="empty-inline value-warning">当前没有任何路径能进入此节点，因此无法得到数值。</div>';
    return `<div class="value-section-list">${Model.numberDefinitionSections(project).map(section => `<section class="value-definition-section">
      <div class="value-section-heading"><strong>${escapeHtml(section.name)}</strong><span>${section.definitions.length} 项</span></div>
      <div class="value-list">${section.definitions.map(definition => {
        const range = result.values[definition.id];
        const detail = range?.exact ? '确定数值' : `${result.possibleStateCount} 种可能状态综合后的上下限`;
        return `<div class="value-row"><span>${escapeHtml(definition.name)}</span><strong>${escapeHtml(Model.formatRange(range))}</strong><small>${escapeHtml(detail)}</small></div>`;
      }).join('')}</div>
    </section>`).join('')}</div>`;
  }

  function effectsMarkup(effects, ownerLabel) {
    if (!project.numberDefinitions.length) return '<div class="empty-inline">请先在元节点定义数值类，才能添加数值变化。</div>';
    const operationOptions = [
      ['add', '增加（＋）'], ['subtract', '减少（−）'], ['multiply', '乘以（×）'], ['divide', '除以（÷）'],
      ['set', '设为（＝）'], ['floorAt', '不低于'], ['capAt', '不高于']
    ];
    const rows = effects.map(effect => {
      const operandControl = effect.operandType === 'variable'
        ? `<select class="compact-select" data-effect-field="operandVariableId">${groupedDefinitionOptions(effect.operandVariableId)}</select>`
        : `<input class="compact-input" data-effect-field="operandValue" type="number" step="any" value="${escapeHtml(effect.operandValue)}">`;
      return `<div class="effect-row" data-effect-id="${escapeHtml(effect.id)}">
        <div class="effect-grid">
          <select class="compact-select" data-effect-field="variableId">${groupedDefinitionOptions(effect.variableId)}</select>
          <select class="compact-select" data-effect-field="operator">${operationOptions.map(([value, label]) => `<option value="${value}"${effect.operator === value ? ' selected' : ''}>${label}</option>`).join('')}</select>
          <button type="button" class="remove-row" data-effect-action="remove" aria-label="删除数值变化">×</button>
        </div>
        <div class="effect-operand">
          <select class="compact-select" data-effect-field="operandType"><option value="number"${effect.operandType === 'number' ? ' selected' : ''}>固定数值</option><option value="variable"${effect.operandType === 'variable' ? ' selected' : ''}>另一数值</option></select>
          ${operandControl}
        </div>
        <div class="effect-preview">${escapeHtml(Model.effectToText(effect, project))}</div>
      </div>`;
    }).join('');
    return `${rows ? `<div class="effect-list">${rows}</div>` : `<div class="empty-inline">${escapeHtml(ownerLabel)}还没有设置数值变化。</div>`}
      <button type="button" class="mini-button accent full-button" data-effect-action="add">＋ 添加数值变化</button>`;
  }

  function definitionRowMarkup(definition) {
    const groupPicker = (project.numberGroups || []).length
      ? `<label class="definition-location"><span>归类</span><select class="compact-select" data-definition-field="groupId" aria-label="${escapeHtml(definition.name)}所属分组">${numberGroupOptions(definition.groupId || '')}</select></label>`
      : '';
    return `<div class="definition-row" data-definition-id="${escapeHtml(definition.id)}">
      <input class="compact-input" data-definition-field="name" value="${escapeHtml(definition.name)}" aria-label="数值名称">
      <input class="compact-input" data-definition-field="initialValue" type="number" step="any" value="${escapeHtml(definition.initialValue)}" aria-label="初始数值">
      <button type="button" class="remove-row" data-definition-action="remove" aria-label="删除${escapeHtml(definition.name)}">×</button>
      ${groupPicker}
    </div>`;
  }

  function definitionsMarkup() {
    const groups = project.numberGroups || [];
    const sections = Model.numberDefinitionSections(project, true);
    return `<div class="definition-groups">${sections.map(section => {
      const isUngrouped = !section.id;
      const groupIndex = isUngrouped ? -1 : groups.findIndex(group => group.id === section.id);
      const collapsed = !isUngrouped && section.collapsed;
      const title = isUngrouped
        ? '<strong class="definition-loose-title">未分组</strong>'
        : `<input class="definition-group-name" data-number-group-field="name" value="${escapeHtml(section.name)}" maxlength="60" aria-label="数值分组名称">`;
      const toggle = isUngrouped
        ? '<span class="definition-group-bullet" aria-hidden="true">•</span>'
        : `<button type="button" class="definition-group-toggle" data-number-group-action="toggle" aria-expanded="${collapsed ? 'false' : 'true'}" title="${collapsed ? '展开分组' : '收起分组'}">${collapsed ? '▸' : '▾'}</button>`;
      const groupActions = isUngrouped ? '' : `<button type="button" class="option-action" data-number-group-action="move-up"${groupIndex <= 0 ? ' disabled' : ''} title="上移分组" aria-label="上移分组">↑</button>
        <button type="button" class="option-action" data-number-group-action="move-down"${groupIndex === groups.length - 1 ? ' disabled' : ''} title="下移分组" aria-label="下移分组">↓</button>
        <button type="button" class="remove-row" data-number-group-action="remove" title="删除分组，内部数值移回未分组" aria-label="删除分组">×</button>`;
      const body = collapsed ? '' : `<div class="definition-group-body">${section.definitions.length
        ? section.definitions.map(definitionRowMarkup).join('')
        : '<div class="group-empty">这个分组还是空的</div>'}</div>`;
      return `<section class="definition-group-card${collapsed ? ' collapsed' : ''}" data-number-group-id="${escapeHtml(section.id)}">
        <div class="definition-group-head">${toggle}<div class="definition-group-title">${title}<span>${section.definitions.length} 项</span></div></div>
        <div class="definition-group-tools"><button type="button" class="mini-button accent" data-definition-action="add" data-target-group-id="${escapeHtml(section.id)}">＋ 数值</button>${groupActions}</div>
        ${body}
      </section>`;
    }).join('')}</div>`;
  }

  function valueOptionsMarkup(node) {
    const options = Model.getValueOptions(node);
    if (!options.length) {
      return '<div class="empty-inline">还没有选项。未设置选项时，这个节点会按“数值不变”继续到共同后续路径。</div>';
    }
    return `<div class="value-option-list">${options.map((option, index) => `<article class="value-option-card" data-value-option-id="${escapeHtml(option.id)}">
      <div class="value-option-head">
        <span class="value-option-index">选项 ${index + 1}</span>
        <div class="value-option-actions">
          <button type="button" class="option-action" data-value-option-action="move-up"${index === 0 ? ' disabled' : ''} title="上移选项" aria-label="上移选项">↑</button>
          <button type="button" class="option-action" data-value-option-action="move-down"${index === options.length - 1 ? ' disabled' : ''} title="下移选项" aria-label="下移选项">↓</button>
          <button type="button" class="option-action option-copy" data-value-option-action="duplicate" title="复制选项">复制</button>
          <button type="button" class="remove-row" data-value-option-action="remove" title="删除选项" aria-label="删除选项">×</button>
        </div>
      </div>
      <label class="field value-option-name"><span>选项名称</span><input class="compact-input" data-value-option-field="name" maxlength="120" value="${escapeHtml(option.name)}" placeholder="例如：买药"></label>
      <div class="value-option-effects">
        <div class="value-option-effect-title"><span>选择后发生的数值变化</span><small>按下方排列顺序依次执行</small></div>
        ${effectsMarkup(option.effects || [], `选项“${option.name || `选项 ${index + 1}`}”`)}
      </div>
    </article>`).join('')}</div>`;
  }

  function renderNodeSidebar(node) {
    const isRoot = node.kind === 'root';
    const isValue = node.kind === 'value';
    const result = calculation.nodeResults.get(node.id);
    const kindLabel = isRoot ? '元节点' : isValue ? '数值节点' : '剧情节点';
    const conversionTarget = isValue ? 'story' : 'value';
    const conversion = isRoot ? null : Model.nodeConversionStatus(project, node.id, conversionTarget);
    dom.sidebar.innerHTML = `<div class="sidebar-inner" data-owner-type="node" data-owner-id="${escapeHtml(node.id)}">
      <div class="sidebar-heading">
        <div><span class="eyebrow">当前选择</span><h2>${kindLabel}</h2></div>
        <span class="status-chip${result?.reachable ? '' : ' danger'}">${isRoot ? '起点' : result?.reachable ? `${formatCount(result.pathCount)} 条路径` : '不可达'}</span>
      </div>
      <label class="field"><span>节点名称</span><input id="node-title-input" data-node-field="title" maxlength="120" value="${escapeHtml(node.title)}" autocomplete="off"></label>
      <label class="field"><span>备注</span><textarea data-node-field="notes" placeholder="记录剧情背景、对白、条件或设计意图……">${escapeHtml(node.notes)}</textarea></label>
      ${!isRoot ? `<section class="section node-conversion-section">
        <div class="section-title"><div><h3>节点类型</h3><p>仅在不会丢失剧情或数值逻辑时允许转换</p></div></div>
        <button type="button" class="mini-button conversion-button${conversion.allowed ? ' accent' : ''}" id="convert-node-kind" data-target-kind="${conversionTarget}"${conversion.allowed ? '' : ' disabled'}>${isValue ? '转换为剧情节点' : '转换为数值节点'}</button>
        <div class="conversion-note${conversion.allowed ? ' available' : ''}">${escapeHtml(conversion.reason)}</div>
      </section>` : ''}
      ${isRoot ? `<section class="section">
        <div class="section-title"><div><h3>数值定义</h3><p>数值类只能在元节点管理；分组只影响整理方式</p></div><div class="section-title-actions"><button type="button" class="mini-button accent" data-definition-action="add" data-target-group-id="">＋ 数值</button><button type="button" class="mini-button" data-number-group-action="add">＋ 分组</button></div></div>
        ${definitionsMarkup()}
      </section>` : ''}
      ${isValue ? `<section class="section value-options-section">
        <div class="section-title"><div><h3>数值选项</h3><p>每次经过只选择一组，所有组仍通向相同的后续剧情</p></div><button type="button" class="mini-button accent" data-value-option-action="add">＋ 添加选项</button></div>
        ${valueOptionsMarkup(node)}
      </section>` : ''}
      <section class="section">
        <div class="section-title"><div><h3>${isRoot ? '初始数值' : isValue ? '各选项执行后的数值' : '到达后的数值'}</h3><p>${isRoot ? '所有路径从这些数值开始' : isValue ? '综合所有可选结果实时计算上下限' : '根据全部有效路径实时计算'}</p></div></div>
        ${valueListMarkup(node.id)}
      </section>
      ${isValue ? '<div class="sidebar-note">每个选项组都是一次互斥选择：只执行被选中组里的数值变化，但不会为它新增剧情节点或分支线。之后仍沿数值节点已有的共同出口继续。</div>' : ''}
    </div>`;
    bindNodeSidebar(node);
  }

  function updateNodeConversionUi(node) {
    if (!node || node.kind === 'root') return;
    const targetKind = node.kind === 'value' ? 'story' : 'value';
    const conversion = Model.nodeConversionStatus(project, node.id, targetKind);
    const button = dom.sidebar.querySelector('#convert-node-kind');
    const note = dom.sidebar.querySelector('.conversion-note');
    if (button) {
      button.disabled = !conversion.allowed;
      button.classList.toggle('accent', conversion.allowed);
    }
    if (note) {
      note.textContent = conversion.reason;
      note.classList.toggle('available', conversion.allowed);
    }
  }

  function conditionOperandMarkup(condition) {
    if (condition.comparator === 'between' || condition.comparator === 'outside') {
      return `<div class="condition-range"><input class="compact-input condition-value-input" type="number" step="any" data-lock-field="rightValue" value="${escapeHtml(condition.rightValue)}" placeholder="下限" aria-label="范围下限"><input class="compact-input condition-value-input" type="number" step="any" data-lock-field="rangeEnd" value="${escapeHtml(condition.rangeEnd)}" placeholder="上限" aria-label="范围上限"></div>`;
    }
    const valueControl = condition.rightType === 'variable'
      ? `<select class="compact-select" data-lock-field="rightVariableId" aria-label="比较数值类">${groupedDefinitionOptions(condition.rightVariableId)}</select>`
      : `<input class="compact-input condition-value-input" type="number" step="any" data-lock-field="rightValue" value="${escapeHtml(condition.rightValue)}" placeholder="输入数值" aria-label="固定数值">`;
    return `<div class="condition-operand"><select class="compact-select" data-lock-field="rightType" aria-label="比较对象"><option value="number"${condition.rightType === 'number' ? ' selected' : ''}>固定值</option><option value="variable"${condition.rightType === 'variable' ? ' selected' : ''}>数值类</option></select>${valueControl}</div>`;
  }

  function conditionGroupMarkup(group, isRoot = false) {
    const children = group.children.map(child => {
      if (child.type === 'group') return conditionGroupMarkup(child, false);
      const comparatorOptions = [['==', '='], ['!=', '≠'], ['>', '>'], ['>=', '≥'], ['<', '<'], ['<=', '≤'], ['between', '范围内'], ['outside', '范围外']];
      return `<div class="condition-row" data-lock-id="${escapeHtml(child.id)}">
        <button type="button" class="condition-not${child.negate ? ' active' : ''}" data-lock-action="toggle-negate" title="条件取反">非</button>
        <select class="compact-select condition-left" data-lock-field="leftVariableId" aria-label="条件数值类">${groupedDefinitionOptions(child.leftVariableId)}</select>
        <select class="compact-select condition-comparator" data-lock-field="comparator" aria-label="比较方式">${comparatorOptions.map(([value, label]) => `<option value="${value}"${child.comparator === value ? ' selected' : ''}>${label}</option>`).join('')}</select>
        ${conditionOperandMarkup(child)}
        <button type="button" class="remove-row" data-lock-action="remove" aria-label="删除条件">×</button>
      </div>`;
    }).join('');
    return `<div class="condition-group" data-lock-id="${escapeHtml(group.id)}">
      <div class="group-head">
        <button type="button" class="condition-not${group.negate ? ' active' : ''}" data-lock-action="toggle-negate" title="整个条件组取反">非</button>
        <span>条件组</span>
        <select class="compact-select" data-lock-field="operator"><option value="AND"${group.operator === 'AND' ? ' selected' : ''}>全部且</option><option value="OR"${group.operator === 'OR' ? ' selected' : ''}>任一或</option><option value="XOR"${group.operator === 'XOR' ? ' selected' : ''}>恰一异或</option></select>
        <div class="group-actions"><button type="button" class="mini-button" data-lock-action="add-condition">＋条件</button><button type="button" class="mini-button" data-lock-action="add-group">＋组</button>${isRoot ? '' : '<button type="button" class="remove-row" data-lock-action="remove" aria-label="删除条件组">×</button>'}</div>
      </div>
      ${children || '<div class="group-empty">空条件组默认允许通行</div>'}
    </div>`;
  }

  function builderToExpression(item) {
    if (item.type === 'group') {
      if (!item.children.length) return 'TRUE';
      const operator = item.operator === 'OR' ? ' || ' : item.operator === 'XOR' ? ' XOR ' : ' && ';
      const content = item.children.map(builderToExpression).join(operator);
      return item.negate ? `!(${content})` : `(${content})`;
    }
    const leftName = Model.getDefinition(project, item.leftVariableId)?.name || '未选择数值';
    const left = `[${leftName}]`;
    let text;
    if (item.comparator === 'between' || item.comparator === 'outside') {
      text = `${item.comparator}(${left}, ${Model.finiteNumber(item.rightValue)}, ${Model.finiteNumber(item.rangeEnd)})`;
    } else {
      const right = item.rightType === 'variable'
        ? `[${Model.getDefinition(project, item.rightVariableId)?.name || '未选择数值'}]`
        : Model.finiteNumber(item.rightValue);
      text = `${left} ${item.comparator} ${right}`;
    }
    return item.negate ? `!(${text})` : text;
  }

  function lockEditorMarkup(line) {
    const lock = line.lock;
    const validation = lock.mode === 'advanced' && lock.enabled
      ? Expr.validate(lock.expression, project.numberDefinitions.map(item => item.name))
      : { valid: true };
    const editor = lock.mode === 'builder'
      ? conditionGroupMarkup(lock.builder, true)
      : `<textarea id="advanced-expression" class="expression-input" placeholder="例如：([年龄] >= 18 && [好感度] >= 50) XOR [声望] < 0">${escapeHtml(lock.expression)}</textarea>
        <div class="variable-pill-sections">${Model.numberDefinitionSections(project).map(section => `<div class="variable-pill-section"><span>${escapeHtml(section.name)}</span><div class="variable-pills">${section.definitions.map(definition => `<button type="button" class="variable-pill" data-variable-name="${escapeHtml(definition.name)}">[${escapeHtml(definition.name)}]</button>`).join('')}</div></div>`).join('')}</div>
        <div class="expression-help">数值类请写成 [名称]。支持 AND/&&、OR/||、XOR/^、NOT/!、括号、四则运算，以及 min、max、abs、round、floor、ceil、sqrt、pow、clamp、between、outside。</div>
        <div id="expression-validation" class="validation${validation.valid ? '' : ' error'}">${validation.valid ? '表达式有效，将逐条路径判断。' : escapeHtml(validation.error)}</div>`;
    return `<div class="switch-row">
      <div class="switch-copy"><strong>启用数值锁</strong><span>不满足条件的路径不能通过</span></div>
      <label class="switch"><input type="checkbox" id="lock-enabled"${lock.enabled ? ' checked' : ''}><span class="switch-track"></span></label>
    </div>
    <div class="tab-row"><button type="button" class="tab-button${lock.mode === 'builder' ? ' active' : ''}" data-lock-mode="builder">可视化配置</button><button type="button" class="tab-button${lock.mode === 'advanced' ? ' active' : ''}" data-lock-mode="advanced">高级表达式</button></div>
    <div class="lock-editor">${editor}</div>
    <div class="lock-preview">当前规则：<code>${escapeHtml(Model.lockToText(line, project))}</code></div>`;
  }

  function renderLineSidebar(line) {
    const source = Model.getNode(project, line.sourceId);
    const target = Model.getNode(project, line.targetId);
    const stats = calculation.edgeStats.get(line.id) || { evaluated: 0, passed: 0, blocked: 0, errors: [] };
    const route = line.route || Model.newLineRoute();
    const isEditingRoute = routeEditState.lineId === line.id;
    const hasSelectedPoint = isEditingRoute && Number.isInteger(routeEditState.pointIndex) && routeEditState.pointIndex >= 0 && routeEditState.pointIndex < (route.points || []).length;
    dom.sidebar.innerHTML = `<div class="sidebar-inner" data-owner-type="line" data-owner-id="${escapeHtml(line.id)}">
      <div class="sidebar-heading">
        <div><span class="eyebrow">当前选择</span><h2>分支线</h2><div class="connection-caption">${escapeHtml(source?.title || '未知节点')} → ${escapeHtml(target?.title || '未知节点')}</div></div>
        <span class="status-chip purple">转移规则</span>
      </div>
      <label class="field"><span>分支线文字</span><input id="line-label-input" maxlength="120" value="${escapeHtml(line.label)}" placeholder="显示在分支线上方，例如：选择坦白"></label>
      <section class="section route-editor-section">
        <div class="section-title"><div><h3>线路走向</h3><p>${route.mode === 'manual' ? '正在使用手动转折点' : '自动分配端口并避让节点、备注和重合线路'}</p></div><span class="route-mode-chip">${route.mode === 'manual' ? '手动' : '自动'}</span></div>
        <div class="route-editor-actions">
          <button type="button" class="mini-button accent" id="route-edit-toggle">${isEditingRoute ? '完成微调' : route.mode === 'manual' ? '继续微调' : '微调线路'}</button>
          <button type="button" class="mini-button" id="route-add-point"${isEditingRoute ? '' : ' disabled'}>＋ 转折点</button>
          <button type="button" class="mini-button danger" id="route-remove-point"${hasSelectedPoint ? '' : ' disabled'}>删除选中点</button>
          <button type="button" class="mini-button" id="route-reset"${route.mode === 'manual' ? '' : ' disabled'}>恢复自动</button>
        </div>
        <div class="sidebar-note">微调时拖动画布上的圆点；先点选圆点才能删除。线路文字和修剪按钮会跟随最长的横向线段。</div>
      </section>
      <section class="section" data-effect-owner="line">
        <div class="section-title"><div><h3>通过后的数值变化</h3><p>先检查数值锁，通过后再执行这些变化</p></div></div>
        ${effectsMarkup(line.effects, '这条分支线')}
      </section>
      <section class="section">
        <div class="section-title"><div><h3>数值锁</h3><p>可嵌套使用且、或、异或和非</p></div></div>
        ${project.numberDefinitions.length ? lockEditorMarkup(line) : '<div class="empty-inline">请先在元节点定义数值类，才能设置数值锁。</div>'}
        <div class="edge-stats"><div class="stat-card"><strong>${formatCount(stats.evaluated)}</strong><span>到达</span></div><div class="stat-card"><strong>${formatCount(stats.passed)}</strong><span>通过</span></div><div class="stat-card"><strong>${formatCount(stats.blocked)}</strong><span>拦截</span></div></div>
        ${stats.errors.length ? `<div class="validation error">${escapeHtml(stats.errors.join('；'))}</div>` : ''}
      </section>
      <section class="section">
        <div class="section-title"><div><h3>插入节点</h3><p>在分支线的起点与终点之间增加一个节点</p></div></div>
        <div class="insert-node-actions"><button type="button" class="mini-button accent" id="sidebar-insert-story">□ 插入剧情节点</button><button type="button" class="mini-button accent" id="sidebar-insert-value">◇ 插入数值节点</button></div>
        <div class="sidebar-note" style="margin-top:10px">插入后会把当前分支线一分为二，原有文字、数值锁和变化保留在前半段。</div>
      </section>
    </div>`;
    bindLineSidebar(line);
  }

  function renderSidebar() {
    const node = selectedNode();
    const line = selectedLine();
    if (routeEditState.lineId && routeEditState.lineId !== line?.id) {
      routeEditState.lineId = null;
      routeEditState.pointIndex = null;
      routeEditState.drag = null;
    }
    if (node) renderNodeSidebar(node);
    else if (line) renderLineSidebar(line);
    else {
      selection = { type: 'node', id: project.rootId };
      renderNodeSidebar(Model.getNode(project, project.rootId));
    }
  }

  function manualNodeOffsetCount() {
    const nodeIds = new Set(project.nodes.map(node => node.id));
    return Object.entries(ensureViewSettings().nodeOffsets)
      .filter(([nodeId, offset]) => nodeIds.has(nodeId) && (offset.x || offset.y)).length;
  }

  function setNodeMoveMode(active, showMessage = true) {
    const next = Boolean(active);
    if (next) {
      if (mergeState.active) cancelMergeMode(false);
      if (connectState.active) cancelConnectMode(false);
      routeEditState.lineId = null;
      routeEditState.pointIndex = null;
      routeEditState.drag = null;
    }
    nodeMoveState.active = next;
    nodeMoveState.drag = null;
    dom.canvas.classList.toggle('node-move-mode', next);
    renderGraph();
    updateToolbar();
    if (showMessage) toast(next ? '节点移动模式已开启：拖节点调整位置，拖空白处仍可移动画布。' : '节点移动模式已关闭。');
  }

  function requestResetNodePositions() {
    const count = manualNodeOffsetCount();
    if (!count) return;
    showDialog({
      title: '重置所有节点位置',
      message: `当前有 ${count} 个节点已被手动调整位置。重置后，它们都会回到系统计算的默认位置。`,
      details: '只会清除节点的位置微调；节点内容、分支线、数值规则和分支线手动转折点都不会被删除。',
      confirmLabel: `重置 ${count} 个节点`,
      onConfirm: () => {
        ensureViewSettings().nodeOffsets = {};
        markDirty();
        refresh({ sidebar: false });
        toast(`已重置 ${count} 个节点的位置。`);
      }
    });
  }

  function updateToolbar() {
    const node = selectedNode();
    const line = selectedLine();
    dom.insertStoryNode.disabled = !line;
    dom.insertStoryNode.title = line ? '在选中的分支线上插入剧情节点' : '请先选中一条分支线';
    dom.insertValueNode.disabled = !line;
    dom.insertValueNode.title = line ? '在选中的分支线上插入数值节点' : '请先选中一条分支线';
    const noteSettings = ensureViewSettings().notes;
    dom.notesToggle.setAttribute('aria-pressed', String(noteSettings.enabled));
    dom.notesPosition.disabled = !noteSettings.enabled;
    dom.notesPosition.value = noteSettings.position;
    const movedCount = manualNodeOffsetCount();
    dom.nodeMoveTool.setAttribute('aria-pressed', String(nodeMoveState.active));
    dom.nodeMoveTool.title = nodeMoveState.active ? '关闭节点移动模式' : '开启后可单独拖动节点，拖空白处仍移动画布';
    dom.resetNodePositions.disabled = movedCount === 0;
    dom.resetNodePositions.title = movedCount ? `重置 ${movedCount} 个手动调整过的节点` : '还没有手动调整过节点位置';
    dom.themeTool.setAttribute('aria-expanded', String(!dom.themePanel.hidden));
    dom.selectionSummary.textContent = node
      ? `已选择${node.kind === 'root' ? '元节点' : node.kind === 'value' ? '数值节点' : '剧情节点'}「${node.title || '未命名'}」`
      : line ? `已选择分支线「${line.label || '未命名分支线'}」` : '未选择内容';
  }

  function bindEffectEditor(container, effects) {
    container.querySelectorAll('[data-effect-action="add"]').forEach(button => button.addEventListener('click', () => {
      if (!project.numberDefinitions.length) return toast('请先在元节点添加数值类。', 'error');
      effects.push(Model.newEffect(defaultVariableId()));
      markDirty(); refresh();
    }));
    container.querySelectorAll('[data-effect-action="remove"]').forEach(button => button.addEventListener('click', event => {
      const row = event.currentTarget.closest('[data-effect-id]');
      const index = effects.findIndex(effect => effect.id === row?.dataset.effectId);
      if (index >= 0) effects.splice(index, 1);
      markDirty(); refresh();
    }));
    container.querySelectorAll('[data-effect-field]').forEach(control => control.addEventListener('change', event => {
      const row = event.currentTarget.closest('[data-effect-id]');
      const effect = effects.find(item => item.id === row?.dataset.effectId);
      if (!effect) return;
      const field = event.currentTarget.dataset.effectField;
      effect[field] = field === 'operandValue' ? Model.finiteNumber(event.currentTarget.value) : event.currentTarget.value;
      if (field === 'operandType' && effect.operandType === 'variable' && !effect.operandVariableId) effect.operandVariableId = defaultVariableId();
      markDirty(); refresh();
    }));
  }

  function nextValueOptionName(node) {
    const names = new Set(Model.getValueOptions(node).map(option => String(option.name || '').trim()));
    let index = Math.max(1, Model.getValueOptions(node).length + 1);
    while (names.has(`选项 ${index}`)) index += 1;
    return `选项 ${index}`;
  }

  function bindValueOptionEditor(node) {
    node.valueOptions = Model.getValueOptions(node);
    dom.sidebar.querySelector('[data-value-option-action="add"]')?.addEventListener('click', () => {
      const option = Model.newValueOption(nextValueOptionName(node));
      node.valueOptions.push(option);
      markDirty(); refresh();
      requestAnimationFrame(() => dom.sidebar.querySelector(`[data-value-option-id="${CSS.escape(option.id)}"] [data-value-option-field="name"]`)?.select());
    });

    dom.sidebar.querySelectorAll('[data-value-option-id]').forEach(card => {
      const option = node.valueOptions.find(item => item.id === card.dataset.valueOptionId);
      if (!option) return;
      card.querySelector('[data-value-option-field="name"]')?.addEventListener('input', event => {
        option.name = event.target.value;
        markDirty(); renderGraph(); updateNodeConversionUi(node);
      });
      card.querySelector('[data-value-option-field="name"]')?.addEventListener('change', event => {
        option.name = event.target.value.trim() || '未命名选项';
        markDirty(); refresh();
      });
      card.querySelectorAll('[data-value-option-action]').forEach(button => button.addEventListener('click', event => {
        const action = event.currentTarget.dataset.valueOptionAction;
        const index = node.valueOptions.findIndex(item => item.id === option.id);
        if (index < 0) return;
        if (action === 'move-up' && index > 0) {
          [node.valueOptions[index - 1], node.valueOptions[index]] = [node.valueOptions[index], node.valueOptions[index - 1]];
          markDirty(); refresh();
        }
        if (action === 'move-down' && index < node.valueOptions.length - 1) {
          [node.valueOptions[index + 1], node.valueOptions[index]] = [node.valueOptions[index], node.valueOptions[index + 1]];
          markDirty(); refresh();
        }
        if (action === 'duplicate') {
          const copy = Model.newValueOption(`${option.name || `选项 ${index + 1}`}（副本）`);
          copy.effects = (option.effects || []).map(effect => ({ ...Model.clone(effect), id: Model.uid('effect') }));
          node.valueOptions.splice(index + 1, 0, copy);
          markDirty(); refresh();
          requestAnimationFrame(() => dom.sidebar.querySelector(`[data-value-option-id="${CSS.escape(copy.id)}"] [data-value-option-field="name"]`)?.select());
        }
        if (action === 'remove') {
          const remove = () => {
            node.valueOptions = node.valueOptions.filter(item => item.id !== option.id);
            markDirty(); refresh();
          };
          if (!(option.effects || []).length) remove();
          else showDialog({
            title: `删除选项“${option.name || `选项 ${index + 1}`}”`,
            message: `这个选项包含 ${(option.effects || []).length} 条数值变化，删除后无法从页面中撤销。`,
            confirmLabel: '删除选项', onConfirm: remove
          });
        }
      }));
      const effectsContainer = card.querySelector('.value-option-effects');
      if (effectsContainer) bindEffectEditor(effectsContainer, option.effects);
    });
  }

  function bindNodeSidebar(node) {
    const titleInput = dom.sidebar.querySelector('[data-node-field="title"]');
    const notesInput = dom.sidebar.querySelector('[data-node-field="notes"]');
    titleInput?.addEventListener('input', event => { node.title = event.target.value; markDirty(); renderGraph(); updateToolbar(); });
    notesInput?.addEventListener('input', event => {
      node.notes = event.target.value;
      markDirty();
      if (ensureViewSettings().notes.enabled) {
        layout = Model.layoutGraph(project);
        renderGraph();
      }
    });

    dom.sidebar.querySelector('#convert-node-kind')?.addEventListener('click', event => {
      const targetKind = event.currentTarget.dataset.targetKind;
      try {
        Model.convertNodeKind(project, node.id, targetKind);
        markDirty(); refresh();
        toast(targetKind === 'value' ? '已转换为数值节点，并建立默认选项。' : '已转换为剧情节点。');
      } catch (error) {
        toast(error instanceof Error ? error.message : '当前无法转换节点类型。', 'error');
      }
    });

    dom.sidebar.querySelectorAll('[data-definition-action="add"]').forEach(button => button.addEventListener('click', event => {
      const requestedGroupId = event.currentTarget.dataset.targetGroupId || '';
      const groupId = Model.getNumberGroup(project, requestedGroupId)?.id || '';
      const base = '新数值';
      let name = base;
      let number = 2;
      const names = new Set(project.numberDefinitions.map(item => item.name));
      while (names.has(name)) name = `${base}${number++}`;
      const definition = { id: Model.uid('number'), name, initialValue: 0, groupId };
      project.numberDefinitions.push(definition);
      const group = Model.getNumberGroup(project, groupId);
      if (group) group.collapsed = false;
      markDirty(); refresh();
      dom.sidebar.querySelector(`[data-definition-id="${CSS.escape(definition.id)}"] [data-definition-field="name"]`)?.select();
    }));

    dom.sidebar.querySelectorAll('[data-number-group-action]').forEach(control => control.addEventListener('click', event => {
      const action = event.currentTarget.dataset.numberGroupAction;
      if (action === 'add') {
        const base = '新分组';
        let name = base;
        let number = 2;
        const names = new Set((project.numberGroups || []).map(item => item.name));
        while (names.has(name)) name = `${base}${number++}`;
        const group = Model.newNumberGroup(name);
        project.numberGroups.push(group);
        markDirty(); refresh();
        dom.sidebar.querySelector(`[data-number-group-id="${CSS.escape(group.id)}"] [data-number-group-field="name"]`)?.select();
        return;
      }
      const holder = event.currentTarget.closest('[data-number-group-id]');
      const group = Model.getNumberGroup(project, holder?.dataset.numberGroupId);
      if (!group) return;
      const index = project.numberGroups.findIndex(item => item.id === group.id);
      if (action === 'toggle') group.collapsed = !group.collapsed;
      if (action === 'move-up' && index > 0) [project.numberGroups[index - 1], project.numberGroups[index]] = [project.numberGroups[index], project.numberGroups[index - 1]];
      if (action === 'move-down' && index < project.numberGroups.length - 1) [project.numberGroups[index + 1], project.numberGroups[index]] = [project.numberGroups[index], project.numberGroups[index + 1]];
      if (action === 'remove') {
        const movedCount = project.numberDefinitions.filter(definition => definition.groupId === group.id).length;
        project.numberDefinitions.forEach(definition => { if (definition.groupId === group.id) definition.groupId = ''; });
        project.numberGroups = project.numberGroups.filter(item => item.id !== group.id);
        markDirty(); refresh();
        toast(movedCount ? `已删除分组“${group.name}”，其中 ${movedCount} 个数值已移至未分组。` : `已删除空分组“${group.name}”。`);
        return;
      }
      markDirty(); refresh();
    }));

    dom.sidebar.querySelectorAll('[data-number-group-field="name"]').forEach(control => {
      const holder = control.closest('[data-number-group-id]');
      const group = Model.getNumberGroup(project, holder?.dataset.numberGroupId);
      if (!group) return;
      const previousName = group.name;
      control.addEventListener('input', event => {
        group.name = event.currentTarget.value;
        markDirty();
      });
      control.addEventListener('change', event => {
        const nextName = event.currentTarget.value.trim();
        if (!nextName) {
          group.name = previousName;
          toast('分组名称不能为空。', 'error');
          refresh();
          return;
        }
        if (project.numberGroups.some(item => item.id !== group.id && item.name.trim() === nextName)) {
          group.name = previousName;
          toast('分组名称不能重复。', 'error');
          refresh();
          return;
        }
        group.name = nextName;
        markDirty(); refresh();
      });
    });

    dom.sidebar.querySelectorAll('[data-definition-field]').forEach(control => {
      const row = control.closest('[data-definition-id]');
      const definition = Model.getDefinition(project, row?.dataset.definitionId);
      if (!definition) return;
      const field = control.dataset.definitionField;
      const previousName = definition.name;
      if (field === 'name') {
        control.addEventListener('input', event => {
          definition.name = event.currentTarget.value;
          markDirty();
        });
      }
      if (field === 'initialValue') {
        control.addEventListener('input', event => {
          definition.initialValue = Model.finiteNumber(event.currentTarget.value);
          markDirty();
        });
      }
      control.addEventListener('change', event => {
        if (field === 'name') {
          const nextName = event.currentTarget.value.trim();
          if (!nextName) {
            definition.name = previousName;
            toast('数值名称不能为空。', 'error');
            refresh();
            return;
          }
          if (project.numberDefinitions.some(item => item.id !== definition.id && item.name.trim() === nextName)) {
            definition.name = previousName;
            toast('数值名称不能重复。', 'error');
            refresh();
            return;
          }
          definition.name = nextName;
          project.branchLines.forEach(line => { line.lock.expression = Expr.renameVariable(line.lock.expression, previousName, nextName); });
        } else if (field === 'groupId') {
          definition.groupId = Model.getNumberGroup(project, event.currentTarget.value)?.id || '';
        } else {
          definition.initialValue = Model.finiteNumber(event.currentTarget.value);
        }
        markDirty(); refresh();
      });
    });

    dom.sidebar.querySelectorAll('[data-definition-action="remove"]').forEach(button => button.addEventListener('click', event => {
      const row = event.currentTarget.closest('[data-definition-id]');
      const definition = Model.getDefinition(project, row?.dataset.definitionId);
      if (!definition) return;
      const references = Model.countReferences(project, definition.id);
      const remove = () => {
        Model.removeVariableReferences(project, definition.id, definition.name);
        project.numberDefinitions = project.numberDefinitions.filter(item => item.id !== definition.id);
        markDirty(); refresh(); toast(`已删除数值类“${definition.name}”。`);
      };
      if (!references.nodeCount && !references.lineCount) return remove();
      showDialog({
        title: `删除数值类“${definition.name}”`,
        message: `此词条已在${references.nodeCount}个节点与${references.lineCount}个分支线被采用。`,
        details: '继续删除会同步清除相关数值变化；引用它的高级数值锁会被关闭，避免留下无法计算的规则。',
        confirmLabel: '仍然删除', onConfirm: remove
      });
    }));

    if (node.kind === 'value') bindValueOptionEditor(node);
  }

  function bindLockEditor(line) {
    const lock = line.lock;
    dom.sidebar.querySelector('#lock-enabled')?.addEventListener('change', event => {
      lock.enabled = event.target.checked;
      markDirty(); refresh();
    });
    dom.sidebar.querySelectorAll('[data-lock-mode]').forEach(button => button.addEventListener('click', event => {
      const mode = event.currentTarget.dataset.lockMode;
      if (mode === lock.mode) return;
      if (mode === 'advanced' && !lock.expression.trim()) lock.expression = builderToExpression(lock.builder);
      lock.mode = mode;
      markDirty(); refresh();
    }));

    dom.sidebar.querySelectorAll('[data-lock-action]').forEach(control => control.addEventListener('click', event => {
      const holder = event.currentTarget.closest('[data-lock-id]');
      const found = Model.findLockItem(lock.builder, holder?.dataset.lockId);
      if (!found) return;
      const action = event.currentTarget.dataset.lockAction;
      if (action === 'toggle-negate') found.item.negate = !found.item.negate;
      if (action === 'add-condition' && found.item.type === 'group') found.item.children.push(Model.newCondition(defaultVariableId()));
      if (action === 'add-group' && found.item.type === 'group') found.item.children.push(Model.newGroup(defaultVariableId()));
      if (action === 'remove' && found.parent) found.parent.children = found.parent.children.filter(item => item.id !== found.item.id);
      markDirty(); refresh();
    }));

    dom.sidebar.querySelectorAll('[data-lock-field]').forEach(control => control.addEventListener('change', event => {
      const holder = event.currentTarget.closest('[data-lock-id]');
      const found = Model.findLockItem(lock.builder, holder?.dataset.lockId);
      if (!found) return;
      const field = event.currentTarget.dataset.lockField;
      found.item[field] = ['rightValue', 'rangeEnd'].includes(field) ? Model.finiteNumber(event.currentTarget.value) : event.currentTarget.value;
      if (field === 'rightType' && found.item.rightType === 'variable' && !found.item.rightVariableId) found.item.rightVariableId = defaultVariableId();
      markDirty(); refresh();
    }));

    const expressionInput = dom.sidebar.querySelector('#advanced-expression');
    expressionInput?.addEventListener('input', event => {
      lock.expression = event.target.value;
      markDirty();
      const result = Expr.validate(lock.expression, project.numberDefinitions.map(item => item.name));
      const validation = dom.sidebar.querySelector('#expression-validation');
      if (validation) {
        validation.className = `validation${result.valid ? '' : ' error'}`;
        validation.textContent = result.valid ? '表达式有效，将逐条路径判断。' : result.error;
      }
      clearTimeout(expressionTimer);
      expressionTimer = setTimeout(() => { calculation = Model.calculate(project); renderGraph(); updateToolbar(); }, 260);
    });
    expressionInput?.addEventListener('change', () => refresh());
    dom.sidebar.querySelectorAll('[data-variable-name]').forEach(button => button.addEventListener('click', event => {
      if (!expressionInput) return;
      const insertion = `[${event.currentTarget.dataset.variableName}]`;
      expressionInput.setRangeText(insertion, expressionInput.selectionStart, expressionInput.selectionEnd, 'end');
      expressionInput.dispatchEvent(new Event('input', { bubbles: true }));
      expressionInput.focus();
    }));
  }

  function bindLineSidebar(line) {
    dom.sidebar.querySelector('#line-label-input')?.addEventListener('input', event => {
      line.label = event.target.value;
      layout = Model.layoutGraph(project);
      markDirty(); renderGraph(); updateToolbar();
    });
    const effectsContainer = dom.sidebar.querySelector('[data-effect-owner="line"]');
    if (effectsContainer) bindEffectEditor(effectsContainer, line.effects);
    if (project.numberDefinitions.length) bindLockEditor(line);
    dom.sidebar.querySelector('#route-edit-toggle')?.addEventListener('click', () => {
      if (routeEditState.lineId === line.id) {
        routeEditState.lineId = null;
        routeEditState.pointIndex = null;
        routeEditState.drag = null;
        renderGraph(); renderSidebar(); updateToolbar();
        return;
      }
      const geometry = edgeRoutes.get(line.id);
      if (!line.route || line.route.mode !== 'manual') {
        const seed = (geometry?.seedPoints || []).map(point => ({ x: Math.round(point.x), y: Math.round(point.y) }));
        if (!seed.length && geometry) seed.push({ x: Math.round(geometry.labelX), y: Math.round(geometry.labelY) });
        line.route = { mode: 'manual', points: seed };
        markDirty();
      }
      routeEditState.lineId = line.id;
      routeEditState.pointIndex = line.route.points.length ? 0 : null;
      renderGraph(); renderSidebar(); updateToolbar();
    });
    dom.sidebar.querySelector('#route-add-point')?.addEventListener('click', () => {
      if (routeEditState.lineId !== line.id) return;
      line.route ||= { mode: 'manual', points: [] };
      const geometry = edgeRoutes.get(line.id);
      if (!geometry) return;
      const leadDistance = Math.min(28, Math.max(16, (geometry.endX - geometry.startX) * .12));
      const candidates = [
        { x: geometry.startX + leadDistance, y: geometry.startY },
        ...line.route.points,
        { x: geometry.endX - leadDistance, y: geometry.endY }
      ];
      let segmentIndex = 0;
      let longest = -1;
      candidates.slice(0, -1).forEach((point, index) => {
        const next = candidates[index + 1];
        const length = Math.hypot(next.x - point.x, next.y - point.y);
        if (length > longest) { longest = length; segmentIndex = index; }
      });
      const first = candidates[segmentIndex];
      const second = candidates[segmentIndex + 1];
      const point = { x: Math.round((first.x + second.x) / 2), y: Math.round((first.y + second.y) / 2) };
      line.route.points.splice(segmentIndex, 0, point);
      routeEditState.pointIndex = segmentIndex;
      markDirty(); renderGraph(); renderSidebar(); updateToolbar();
    });
    dom.sidebar.querySelector('#route-remove-point')?.addEventListener('click', () => {
      if (routeEditState.lineId !== line.id || !Number.isInteger(routeEditState.pointIndex)) return;
      line.route?.points.splice(routeEditState.pointIndex, 1);
      routeEditState.pointIndex = null;
      markDirty(); renderGraph(); renderSidebar(); updateToolbar();
    });
    dom.sidebar.querySelector('#route-reset')?.addEventListener('click', () => {
      line.route = Model.newLineRoute();
      routeEditState.lineId = null;
      routeEditState.pointIndex = null;
      routeEditState.drag = null;
      markDirty(); renderGraph(); renderSidebar(); updateToolbar();
      toast('已恢复自动线路。');
    });
    dom.sidebar.querySelector('#sidebar-insert-story')?.addEventListener('click', () => insertNodeOnLine(line.id, 'story'));
    dom.sidebar.querySelector('#sidebar-insert-value')?.addEventListener('click', () => insertNodeOnLine(line.id, 'value'));
  }

  function createChild(parentId) {
    const node = { id: Model.uid('node'), kind: 'story', title: '新节点', notes: '', effects: [], valueOptions: [], createdAt: Model.nowIso(), sortIndex: project.nodes.length };
    const line = { id: Model.uid('line'), sourceId: parentId, targetId: node.id, label: '', effects: [], lock: Model.newLock(defaultVariableId()), route: Model.newLineRoute(), createdAt: Model.nowIso() };
    project.nodes.push(node);
    project.branchLines.push(line);
    selection = { type: 'node', id: node.id };
    markDirty(); refresh();
    requestAnimationFrame(() => { focusNode(node.id); dom.sidebar.querySelector('#node-title-input')?.select(); });
  }

  function insertNodeOnLine(lineId, kind) {
    try {
      const { node } = Model.insertNodeOnLine(project, lineId, kind);
      selection = { type: 'node', id: node.id };
      markDirty(); refresh();
      toast(`已在分支线上插入${kind === 'value' ? '数值' : '剧情'}节点。`);
      requestAnimationFrame(() => {
        focusNode(node.id);
        if (kind === 'story') dom.sidebar.querySelector('#node-title-input')?.select();
      });
    } catch (error) {
      toast(error instanceof Error ? error.message : '插入节点失败。', 'error');
    }
  }

  function isEditedNode(node) {
    const defaultTitles = new Set(['新节点', '收束节点', '数值调整', '数值选择']);
    const options = Model.getValueOptions(node);
    const hasEditedOptions = node.kind === 'value' && (
      options.length !== 1 ||
      options[0]?.name?.trim() !== '选项 1' ||
      Boolean(options[0]?.effects?.length)
    );
    return Boolean(node.notes.trim() || (node.effects || []).length || hasEditedOptions || (!defaultTitles.has(node.title.trim()) && node.kind !== 'root'));
  }

  function isEditedLine(line) { return Boolean(line.label.trim() || line.effects.length || line.lock?.enabled || line.route?.mode === 'manual'); }

  function pruneBranch(lineId) {
    const line = Model.getLine(project, lineId);
    if (!line) return;
    const before = Model.reachableSet(project);
    const after = Model.reachableSet(project, lineId);
    const removedNodeIds = new Set([...before].filter(id => id !== project.rootId && !after.has(id)));
    const removedLines = project.branchLines.filter(item => item.id === lineId || removedNodeIds.has(item.sourceId) || removedNodeIds.has(item.targetId));
    const removedNodes = project.nodes.filter(node => removedNodeIds.has(node.id));
    const editedNodes = removedNodes.filter(isEditedNode);
    const editedLines = removedLines.filter(item => item.id !== lineId && isEditedLine(item));
    const remove = () => {
      project.nodes = project.nodes.filter(node => !removedNodeIds.has(node.id));
      const removedLineIds = new Set(removedLines.map(item => item.id));
      project.branchLines = project.branchLines.filter(item => !removedLineIds.has(item.id));
      selection = { type: 'node', id: project.rootId };
      markDirty(); refresh();
      toast(removedNodes.length ? `已修剪 ${removedNodes.length} 个节点。` : '已删除分支线。');
    };
    if (!editedNodes.length && !editedLines.length) return remove();
    showDialog({
      title: '修剪包含内容的分支',
      message: `这次操作将删除 ${removedNodes.length} 个节点和 ${removedLines.length} 条分支线，其中已有内容被编辑。`,
      details: [
        editedNodes.length ? `已编辑节点：${editedNodes.map(node => node.title || '未命名节点').join('、')}` : '',
        editedLines.length ? `已编辑分支线：${editedLines.map(item => item.label || '未命名分支线').join('、')}` : ''
      ].filter(Boolean).join('\n'),
      confirmLabel: '确认修剪', onConfirm: remove
    });
  }

  function startMergeMode() {
    if (connectState.active) cancelConnectMode(false);
    if (nodeMoveState.active) setNodeMoveMode(false, false);
    mergeState.active = true;
    mergeState.sources.clear();
    mergeState.selectingTarget = false;
    dom.mergeTool.setAttribute('aria-pressed', 'true');
    dom.mergeDock.hidden = false;
    renderGraph();
  }

  function cancelMergeMode(shouldRender = true) {
    mergeState.active = false;
    mergeState.sources.clear();
    mergeState.selectingTarget = false;
    dom.mergeTool.setAttribute('aria-pressed', 'false');
    dom.mergeDock.hidden = true;
    if (shouldRender) renderGraph();
  }

  function updateMergeDock() {
    if (!mergeState.active) return;
    const count = mergeState.sources.size;
    dom.mergeDock.hidden = false;
    dom.mergeCreate.disabled = count < 2 || mergeState.selectingTarget;
    dom.mergeExisting.disabled = count < 2 || mergeState.selectingTarget;
    dom.mergeMessage.textContent = mergeState.selectingTarget
      ? '现在点击一个已有节点作为收束目标'
      : count < 2 ? `已选 ${count} 个，请至少选择两个节点` : `已选 ${count} 个节点，可以新建或选择已有收束节点`;
  }

  function startConnectMode() {
    if (mergeState.active) cancelMergeMode(false);
    if (nodeMoveState.active) setNodeMoveMode(false, false);
    connectState.active = true;
    connectState.sourceId = null;
    dom.connectTool.setAttribute('aria-pressed', 'true');
    dom.connectDock.hidden = false;
    dom.canvas.classList.add('connect-mode');
    renderGraph();
  }

  function cancelConnectMode(shouldRender = true) {
    connectState.active = false;
    connectState.sourceId = null;
    dom.connectTool.setAttribute('aria-pressed', 'false');
    dom.connectDock.hidden = true;
    dom.canvas.classList.remove('connect-mode');
    if (shouldRender) renderGraph();
  }

  function updateConnectDock() {
    if (!connectState.active) return;
    const source = connectState.sourceId ? Model.getNode(project, connectState.sourceId) : null;
    dom.connectDock.hidden = false;
    dom.connectReset.disabled = !source;
    dom.connectMessage.textContent = source
      ? `起点“${source.title || '未命名节点'}”已选；现在点击终点剧情节点（起点 → 终点）`
      : '先点击起点剧情节点，再点击终点剧情节点（起点 → 终点）';
  }

  function resetConnectSource() {
    connectState.sourceId = null;
    renderGraph();
  }

  function chooseConnectNode(nodeId) {
    const node = Model.getNode(project, nodeId);
    if (!node || node.kind !== 'story') return toast('连线只能选择剧情节点，不能选择元节点或数值节点。', 'error');
    if (!connectState.sourceId) {
      connectState.sourceId = nodeId;
      selection = { type: 'node', id: nodeId };
      renderGraph(); renderSidebar(); updateToolbar();
      return;
    }
    const sourceId = connectState.sourceId;
    const source = Model.getNode(project, sourceId);
    if (sourceId === nodeId) return toast('起点和终点不能是同一个剧情节点。', 'error');
    if (project.branchLines.some(line => line.sourceId === sourceId && line.targetId === nodeId)) return toast('这两个节点之间已经有一条同方向分支线。', 'error');
    if (Model.wouldCreateCycle(project, sourceId, nodeId)) return toast('这条分支线会形成循环，无法创建。', 'error');
    const line = { id: Model.uid('line'), sourceId, targetId: nodeId, label: '', effects: [], lock: Model.newLock(defaultVariableId()), route: Model.newLineRoute(), createdAt: Model.nowIso() };
    project.branchLines.push(line);
    selection = { type: 'line', id: line.id };
    markDirty(); cancelConnectMode(false); refresh();
    toast(`已创建分支线：${source?.title || '未命名节点'} → ${node.title || '未命名节点'}。`);
    requestAnimationFrame(() => focusNode(nodeId));
  }

  function toggleMergeSource(nodeId) {
    if (nodeId === project.rootId) return toast('元节点不能作为收束来源。', 'error');
    if (mergeState.sources.has(nodeId)) mergeState.sources.delete(nodeId);
    else mergeState.sources.add(nodeId);
    renderGraph();
  }

  function createMergeTarget() {
    if (mergeState.sources.size < 2) return;
    const target = { id: Model.uid('node'), kind: 'story', title: '收束节点', notes: '', effects: [], valueOptions: [], createdAt: Model.nowIso(), sortIndex: project.nodes.length };
    project.nodes.push(target);
    mergeState.sources.forEach(sourceId => project.branchLines.push({ id: Model.uid('line'), sourceId, targetId: target.id, label: '', effects: [], lock: Model.newLock(defaultVariableId()), route: Model.newLineRoute(), createdAt: Model.nowIso() }));
    selection = { type: 'node', id: target.id };
    markDirty(); cancelMergeMode(false); refresh();
    requestAnimationFrame(() => { focusNode(target.id); dom.sidebar.querySelector('#node-title-input')?.select(); });
  }

  function mergeIntoExisting(targetId) {
    if (targetId === project.rootId) return toast('不能收束回元节点。', 'error');
    if (mergeState.sources.has(targetId)) return toast('收束目标不能同时是来源节点。', 'error');
    const sources = [...mergeState.sources];
    if (sources.some(sourceId => Model.wouldCreateCycle(project, sourceId, targetId))) return toast('这个连接会形成循环，无法收束。', 'error');
    let created = 0;
    sources.forEach(sourceId => {
      if (project.branchLines.some(line => line.sourceId === sourceId && line.targetId === targetId)) return;
      project.branchLines.push({ id: Model.uid('line'), sourceId, targetId, label: '', effects: [], lock: Model.newLock(defaultVariableId()), route: Model.newLineRoute(), createdAt: Model.nowIso() });
      created += 1;
    });
    if (!created) return toast('这些节点已经连接到该目标。', 'error');
    selection = { type: 'node', id: targetId };
    markDirty(); cancelMergeMode(false); refresh(); toast(`已创建 ${created} 条收束分支线。`);
    requestAnimationFrame(() => focusNode(targetId));
  }

  function showSearchResults() {
    const query = dom.searchInput.value.trim().toLocaleLowerCase('zh-CN');
    if (!query) { dom.searchResults.hidden = true; searchActiveIndex = -1; return; }
    const matches = project.nodes.filter(node => {
      const optionNames = Model.getValueOptions(node).map(option => option.name).join('\n');
      return `${node.title}\n${node.notes}\n${optionNames}`.toLocaleLowerCase('zh-CN').includes(query);
    }).slice(0, 30);
    searchActiveIndex = matches.length ? Math.min(Math.max(searchActiveIndex, 0), matches.length - 1) : -1;
    dom.searchResults.innerHTML = matches.length ? matches.map((node, index) => {
      const optionSummary = Model.getValueOptions(node).map(option => option.name || '未命名选项').join('、');
      const excerpt = node.notes.trim().replace(/\s+/g, ' ') || optionSummary || (node.kind === 'root' ? '元节点' : node.kind === 'value' ? '数值节点' : '剧情节点');
      return `<button type="button" class="search-result${index === searchActiveIndex ? ' active' : ''}" data-search-node="${escapeHtml(node.id)}"><strong>${escapeHtml(node.title || '未命名节点')}</strong><span>${escapeHtml(capText(excerpt, 46))}</span></button>`;
    }).join('') : '<div class="search-empty">没有找到匹配的节点或备注</div>';
    dom.searchResults.hidden = false;
  }

  function chooseSearchNode(nodeId) {
    selection = { type: 'node', id: nodeId };
    dom.searchInput.value = '';
    dom.searchResults.hidden = true;
    refresh();
    requestAnimationFrame(() => focusNode(nodeId));
  }

  function routeReport() {
    calculation = Model.calculate(project);
    renderGraph();
    const unreachable = project.nodes.filter(node => node.id !== project.rootId).filter(node => {
      const result = calculation.nodeResults.get(node.id);
      return result?.structuralReachable && !result.reachable;
    });
    if (!unreachable.length && !calculation.errors.length) {
      showDialog({ title: '通路检查完成', message: '所有在结构上相连的节点都至少有一条有效路径可以进入。', details: calculation.warnings.join('\n'), icon: '✓', danger: false, cancelVisible: false, confirmLabel: '关闭' });
      return;
    }
    const items = unreachable.map(node => {
      const blockers = Model.incomingLines(project, node.id).filter(line => {
        const sourceResult = calculation.nodeResults.get(line.sourceId);
        const stats = calculation.edgeStats.get(line.id);
        return sourceResult?.reachable && stats?.evaluated > 0 && stats.passed === 0 && line.lock?.enabled;
      });
      const nodeRuleErrors = calculation.errors.filter(message => message.startsWith(`数值节点“${node.title || '未命名数值节点'}”`));
      const reason = nodeRuleErrors.length
        ? `该数值节点的选项没有产生有效状态：${nodeRuleErrors.join('；')}`
        : blockers.length
        ? blockers.map(line => `分支线“${line.label || '未命名分支线'}”：${Model.lockToText(line, project)}`).join('；')
        : '所有前置路径已在更早的数值锁处中断';
      return `<div class="report-item"><strong>${escapeHtml(node.title || '未命名节点')}</strong><span>${escapeHtml(reason)}</span></div>`;
    }).join('');
    const errorMarkup = calculation.errors.length
      ? `<div class="report-item"><strong>规则错误</strong><span>${escapeHtml(calculation.errors.join('；'))}</span></div>` : '';
    showDialog({
      title: unreachable.length ? '发现无法进入的节点' : '发现数值规则错误',
      message: unreachable.length
        ? `共有 ${unreachable.length} 个节点因为数值锁或其上游阻断而实际不可达。`
        : '当前没有不可达节点，但存在需要修正的数值规则。',
      detailsHtml: `<div class="report-list">${items}${errorMarkup}</div>`,
      icon: '!', danger: false, cancelVisible: false, confirmLabel: '关闭'
    });
  }

  async function saveProject(reason = 'manual', silent = false) {
    project.meta.updatedAt = Model.nowIso();
    try {
      const response = await fetch('/api/save', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason, project })
      });
      if (!response.ok) throw new Error(`保存失败（${response.status}）`);
      dirty = false;
      const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      setSaveStatus(reason === 'autosave' ? `${time} 已自动备份` : `${time} 已保存`, 'saved');
      if (!silent && reason !== 'autosave') toast('项目已保存到软件缓存文件夹。');
      return true;
    } catch (error) {
      setSaveStatus('保存失败', 'unsaved');
      if (!silent) toast(error instanceof Error ? error.message : '保存失败', 'error');
      return false;
    }
  }

  function exportProject() {
    calculation = Model.calculate(project);
    const exported = Model.buildAiExport(project, calculation);
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const safeTitle = (project.meta.title || '剧情脉络').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
    anchor.href = url;
    anchor.download = `${safeTitle}.storymap.json`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('已导出可供 AI 阅读和再次导入的逻辑文件。');
  }

  async function importProjectFile(file) {
    try {
      const content = await file.text();
      const parsed = JSON.parse(content);
      const imported = Model.normalizeProject(parsed);
      cancelMergeMode(false); cancelConnectMode(false);
      routeEditState.lineId = null; routeEditState.pointIndex = null; routeEditState.drag = null;
      nodeMoveState.active = false; nodeMoveState.drag = null; hoveredNodeId = null;
      project = imported;
      applyTheme();
      selection = { type: 'node', id: project.rootId };
      dirty = true;
      firstFit = true;
      refresh();
      await saveProject('import', true);
      requestAnimationFrame(fitView);
      toast(`已导入“${project.meta.title}”。`);
    } catch (error) {
      toast(`导入失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    } finally {
      dom.importFile.value = '';
    }
  }

  function newProject() {
    const create = () => {
      cancelMergeMode(false); cancelConnectMode(false);
      routeEditState.lineId = null; routeEditState.pointIndex = null; routeEditState.drag = null;
      nodeMoveState.active = false; nodeMoveState.drag = null; hoveredNodeId = null;
      project = Model.createDefaultProject();
      applyTheme();
      selection = { type: 'node', id: project.rootId };
      firstFit = true;
      markDirty(); refresh();
      requestAnimationFrame(fitView);
    };
    if (!dirty && project.nodes.length === 1 && !project.numberDefinitions.length) return create();
    showDialog({ title: '新建项目', message: '当前页面内容会被新的空白项目替换。最近一次缓存仍保留在缓存文件夹中。', confirmLabel: '新建空白项目', onConfirm: create });
  }

  async function loadProject() {
    await loadThemePresets();
    try {
      const response = await fetch('/api/project', { cache: 'no-store' });
      if (!response.ok) throw new Error('无法读取缓存');
      const cached = await response.json();
      project = cached ? Model.normalizeProject(cached) : Model.createDefaultProject();
      applyTheme();
      setSaveStatus(cached ? '已从最近缓存恢复' : '新的本地项目', cached ? 'saved' : '');
    } catch (error) {
      project = Model.createDefaultProject();
      applyTheme();
      setSaveStatus('缓存读取失败，已打开空白项目', 'unsaved');
      toast(error instanceof Error ? error.message : '缓存读取失败', 'error');
    }
    selection = { type: 'node', id: project.rootId };
    loaded = true;
    dirty = false;
    dom.projectTitle.value = project.meta.title;
    refresh();
    registerWebMcpTools();
    requestAnimationFrame(() => { if (firstFit) { fitView(); firstFit = false; } });
  }

  function registerWebMcpTools() {
    const context = document.modelContext;
    if (webMcpRegistered || !context?.registerTool) return;
    webMcpRegistered = true;
    const register = tool => {
      try { void Promise.resolve(context.registerTool(tool, { signal: webMcpLifecycle.signal })).catch(() => {}); }
      catch { /* Unsupported preview implementations are harmless. */ }
    };
    register({
      name: 'read_story_map_summary', title: '读取剧情图摘要',
      description: '读取当前剧情图的项目名称、数值类、节点与分支线数量，不修改内容。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute() {
        const current = Model.calculate(project);
        return {
          title: project.meta.title,
          rootNodeId: project.rootId,
          numericClasses: project.numberDefinitions.map(item => ({
            id: item.id,
            name: item.name,
            initialValue: item.initialValue,
            group: Model.getNumberGroup(project, item.groupId)?.name || '未分组'
          })),
          nodeCount: project.nodes.length,
          branchLineCount: project.branchLines.length,
          unreachableNodeCount: project.nodes.filter(node => node.id !== project.rootId && current.nodeResults.get(node.id)?.structuralReachable && !current.nodeResults.get(node.id)?.reachable).length
        };
      }
    });
    register({
      name: 'create_story_child', title: '创建剧情子节点',
      description: '在指定节点右侧创建一个新的剧情子节点，并同步更新可见画布。',
      inputSchema: {
        type: 'object',
        properties: { parentNodeId: { type: 'string' }, title: { type: 'string' }, notes: { type: 'string' }, branchLineText: { type: 'string' } },
        required: ['parentNodeId', 'title'], additionalProperties: false
      },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || typeof input.parentNodeId !== 'string' || !Model.getNode(project, input.parentNodeId)) throw new Error('parentNodeId 不是当前项目中的节点。');
        if (typeof input.title !== 'string' || !input.title.trim()) throw new Error('title 不能为空。');
        const node = { id: Model.uid('node'), kind: 'story', title: input.title.trim(), notes: String(input.notes || ''), effects: [], valueOptions: [], createdAt: Model.nowIso(), sortIndex: project.nodes.length };
        const line = { id: Model.uid('line'), sourceId: input.parentNodeId, targetId: node.id, label: String(input.branchLineText || ''), effects: [], lock: Model.newLock(defaultVariableId()), route: Model.newLineRoute(), createdAt: Model.nowIso() };
        project.nodes.push(node); project.branchLines.push(line);
        selection = { type: 'node', id: node.id };
        markDirty(); refresh(); focusNode(node.id);
        return { created: true, nodeId: node.id, branchLineId: line.id };
      }
    });
    register({
      name: 'check_numeric_routes', title: '检查数值通路',
      description: '计算全部路径并返回因为数值锁而不可进入的节点，不修改内容。',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute() {
        const current = Model.calculate(project);
        return {
          unreachableNodes: project.nodes.filter(node => node.id !== project.rootId && current.nodeResults.get(node.id)?.structuralReachable && !current.nodeResults.get(node.id)?.reachable).map(node => ({ id: node.id, name: node.title })),
          errors: current.errors, warnings: current.warnings
        };
      }
    });
  }

  function bindGlobalEvents() {
    dom.edgeLayer.addEventListener('pointerdown', event => {
      const handle = event.target.closest('[data-route-handle]');
      const group = handle?.closest('[data-edge-id]');
      if (!handle || !group || event.button !== 0 || event.isPrimary === false) return;
      const line = Model.getLine(project, group.dataset.edgeId);
      const pointIndex = Number(handle.dataset.routeHandle);
      const point = line?.route?.points?.[pointIndex];
      if (!line || routeEditState.lineId !== line.id || !point) return;
      event.preventDefault();
      event.stopPropagation();
      selection = { type: 'line', id: line.id };
      routeEditState.pointIndex = pointIndex;
      routeEditState.drag = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin: { x: point.x, y: point.y },
        moved: false
      };
      try { dom.edgeLayer.setPointerCapture(event.pointerId); } catch { /* Pointer capture is an enhancement. */ }
      renderGraph(); renderSidebar(); updateToolbar();
    });

    dom.nodeLayer.addEventListener('pointerdown', event => {
      if (!nodeMoveState.active || mergeState.active || connectState.active || event.button !== 0 || event.isPrimary === false) return;
      if (event.target.closest('button, input, textarea, select')) return;
      const nodeElement = event.target.closest('[data-node-id]');
      if (!nodeElement) return;
      const nodeId = nodeElement.dataset.nodeId;
      const current = ensureViewSettings().nodeOffsets[nodeId];
      event.preventDefault();
      event.stopPropagation();
      selection = { type: 'node', id: nodeId };
      nodeMoveState.drag = {
        nodeId,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin: current ? { ...current } : { x: 0, y: 0 },
        hadOrigin: Boolean(current),
        moved: false
      };
      try { dom.nodeLayer.setPointerCapture(event.pointerId); } catch { /* Window-level events still finish the drag. */ }
      renderGraph(); renderSidebar(); updateToolbar();
    });

    dom.canvas.addEventListener('pointerdown', event => {
      if (view.pointerId !== null || event.isPrimary === false || ![0, 1].includes(event.button)) return;
      if (event.target.closest('button, input, textarea, select')) return;
      event.preventDefault();
      view.pointerId = event.pointerId;
      view.startX = event.clientX;
      view.startY = event.clientY;
      view.lastX = event.clientX;
      view.lastY = event.clientY;
    });
    window.addEventListener('pointermove', event => {
      const nodeDrag = nodeMoveState.drag;
      if (nodeDrag?.pointerId === event.pointerId) {
        event.preventDefault();
        const distance = Math.hypot(event.clientX - nodeDrag.startX, event.clientY - nodeDrag.startY);
        if (!nodeDrag.moved && distance < 3) return;
        nodeDrag.moved = true;
        const offsets = ensureViewSettings().nodeOffsets;
        offsets[nodeDrag.nodeId] = {
          x: Math.round(nodeDrag.origin.x + (event.clientX - nodeDrag.startX) / view.scale),
          y: Math.round(nodeDrag.origin.y + (event.clientY - nodeDrag.startY) / view.scale)
        };
        layout = Model.layoutGraph(project);
        edgeRoutes = Model.routeBranchLines(project, layout);
        renderGraph();
        return;
      }
      const routeDrag = routeEditState.drag;
      if (routeDrag?.pointerId === event.pointerId) {
        event.preventDefault();
        if (!routeDrag.moved && Math.hypot(event.clientX - routeDrag.startX, event.clientY - routeDrag.startY) < 2) return;
        routeDrag.moved = true;
        const line = Model.getLine(project, routeEditState.lineId);
        const point = line?.route?.points?.[routeEditState.pointIndex];
        if (!point) return;
        const bounds = dom.canvas.getBoundingClientRect();
        point.x = Math.round(Math.max(24, Math.min(layout.width - 24, (event.clientX - bounds.left - view.x) / view.scale)));
        point.y = Math.round(Math.max(24, Math.min(layout.height - 24, (event.clientY - bounds.top - view.y) / view.scale)));
        renderGraph();
        return;
      }
      if (view.pointerId !== event.pointerId) return;
      if (!view.dragging) {
        const distance = Math.hypot(event.clientX - view.startX, event.clientY - view.startY);
        if (distance < 5) return;
        view.dragging = true;
        dom.canvas.classList.add('dragging');
        dom.canvas.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
      view.x += event.clientX - view.lastX;
      view.y += event.clientY - view.lastY;
      view.lastX = event.clientX;
      view.lastY = event.clientY;
      applyView();
    });
    const endDrag = (event, cancelled = false) => {
      if (view.pointerId !== event.pointerId) return;
      const moved = view.dragging;
      view.pointerId = null;
      view.dragging = false;
      dom.canvas.classList.remove('dragging');
      if (dom.canvas.hasPointerCapture(event.pointerId)) dom.canvas.releasePointerCapture(event.pointerId);
      if (moved && !cancelled) {
        view.suppressClick = true;
        setTimeout(() => { view.suppressClick = false; }, 0);
      }
    };
    const endRouteDrag = (event, cancelled = false) => {
      const drag = routeEditState.drag;
      if (!drag || drag.pointerId !== event.pointerId) return false;
      const line = Model.getLine(project, routeEditState.lineId);
      const point = line?.route?.points?.[routeEditState.pointIndex];
      if (cancelled && point) Object.assign(point, drag.origin);
      if (dom.edgeLayer.hasPointerCapture?.(event.pointerId)) dom.edgeLayer.releasePointerCapture(event.pointerId);
      routeEditState.drag = null;
      if (drag.moved && !cancelled) {
        markDirty();
        view.suppressClick = true;
        setTimeout(() => { view.suppressClick = false; }, 0);
      }
      renderGraph(); renderSidebar(); updateToolbar();
      return true;
    };
    const endNodeDrag = (event, cancelled = false) => {
      const drag = nodeMoveState.drag;
      if (!drag || drag.pointerId !== event.pointerId) return false;
      const offsets = ensureViewSettings().nodeOffsets;
      if (cancelled) {
        if (drag.hadOrigin) offsets[drag.nodeId] = { ...drag.origin };
        else delete offsets[drag.nodeId];
      } else if (offsets[drag.nodeId] && !offsets[drag.nodeId].x && !offsets[drag.nodeId].y) {
        delete offsets[drag.nodeId];
      }
      if (dom.nodeLayer.hasPointerCapture?.(event.pointerId)) dom.nodeLayer.releasePointerCapture(event.pointerId);
      nodeMoveState.drag = null;
      if (drag.moved && !cancelled) {
        markDirty();
        view.suppressClick = true;
        setTimeout(() => { view.suppressClick = false; }, 0);
      }
      layout = Model.layoutGraph(project);
      edgeRoutes = Model.routeBranchLines(project, layout);
      renderGraph(); renderSidebar(); updateToolbar();
      return true;
    };
    window.addEventListener('pointerup', event => { if (!endNodeDrag(event) && !endRouteDrag(event)) endDrag(event); });
    window.addEventListener('pointercancel', event => { if (!endNodeDrag(event, true) && !endRouteDrag(event, true)) endDrag(event, true); });
    dom.canvas.addEventListener('click', event => {
      if (!view.suppressClick) return;
      view.suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    dom.canvas.addEventListener('dragstart', event => event.preventDefault());
    dom.canvas.addEventListener('selectstart', event => event.preventDefault());
    dom.canvas.addEventListener('wheel', event => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, view.scale * (event.deltaY > 0 ? .9 : 1.1));
    }, { passive: false });

    dom.nodeLayer.addEventListener('click', event => {
      const nodeElement = event.target.closest('[data-node-id]');
      if (!nodeElement) return;
      const nodeId = nodeElement.dataset.nodeId;
      if (connectState.active) {
        event.stopPropagation();
        chooseConnectNode(nodeId);
        return;
      }
      if (event.target.closest('[data-node-action="add"]')) { event.stopPropagation(); createChild(nodeId); return; }
      if (mergeState.active) {
        if (mergeState.selectingTarget) mergeIntoExisting(nodeId);
        else toggleMergeSource(nodeId);
        return;
      }
      selection = { type: 'node', id: nodeId };
      renderGraph(); renderSidebar(); updateToolbar();
    });
    dom.nodeLayer.addEventListener('pointerover', event => {
      const nodeElement = event.target.closest('[data-node-id]');
      if (!nodeElement || nodeElement.contains(event.relatedTarget)) return;
      setHoveredNode(nodeElement.dataset.nodeId);
    });
    dom.nodeLayer.addEventListener('pointerout', event => {
      const nodeElement = event.target.closest('[data-node-id]');
      if (!nodeElement || nodeElement.contains(event.relatedTarget)) return;
      setHoveredNode(null);
    });
    dom.nodeLayer.addEventListener('dblclick', event => {
      const nodeElement = event.target.closest('[data-node-id]');
      if (!nodeElement || event.target.closest('.node-add') || mergeState.active || connectState.active) return;
      selection = { type: 'node', id: nodeElement.dataset.nodeId };
      renderGraph(); renderSidebar(); updateToolbar();
      dom.sidebar.querySelector('#node-title-input')?.select();
    });
    dom.nodeLayer.addEventListener('keydown', event => {
      if (!['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      event.target.click();
    });

    dom.edgeLayer.addEventListener('click', event => {
      const group = event.target.closest('[data-edge-id]');
      if (!group) return;
      const lineId = group.dataset.edgeId;
      const handle = event.target.closest('[data-route-handle]');
      if (handle) {
        selection = { type: 'line', id: lineId };
        routeEditState.pointIndex = Number(handle.dataset.routeHandle);
        renderGraph(); renderSidebar(); updateToolbar();
      } else if (event.target.closest('[data-edge-action="delete"]')) pruneBranch(lineId);
      else {
        if (routeEditState.lineId && routeEditState.lineId !== lineId) {
          routeEditState.lineId = null;
          routeEditState.pointIndex = null;
          routeEditState.drag = null;
        }
        selection = { type: 'line', id: lineId };
        renderGraph(); renderSidebar(); updateToolbar();
      }
    });

    dom.projectTitle.addEventListener('input', event => {
      project.meta.title = event.target.value;
      markDirty();
    });
    $('#new-project').addEventListener('click', newProject);
    $('#import-project').addEventListener('click', () => dom.importFile.click());
    dom.importFile.addEventListener('change', () => { if (dom.importFile.files?.[0]) importProjectFile(dom.importFile.files[0]); });
    $('#save-project').addEventListener('click', () => saveProject('manual'));
    $('#export-project').addEventListener('click', exportProject);
    $('#route-check').addEventListener('click', routeReport);
    $('#fit-view').addEventListener('click', fitView);
    dom.nodeMoveTool.addEventListener('click', () => setNodeMoveMode(!nodeMoveState.active));
    dom.resetNodePositions.addEventListener('click', requestResetNodePositions);
    $('#zoom-in').addEventListener('click', () => {
      const bounds = dom.canvas.getBoundingClientRect(); zoomAt(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, view.scale * 1.15);
    });
    $('#zoom-out').addEventListener('click', () => {
      const bounds = dom.canvas.getBoundingClientRect(); zoomAt(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, view.scale * .85);
    });
    dom.zoomLabel.addEventListener('click', () => {
      const bounds = dom.canvas.getBoundingClientRect(); zoomAt(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2, 1);
    });

    dom.mergeTool.addEventListener('click', () => mergeState.active ? cancelMergeMode() : startMergeMode());
    $('#merge-cancel').addEventListener('click', cancelMergeMode);
    dom.mergeCreate.addEventListener('click', createMergeTarget);
    dom.mergeExisting.addEventListener('click', () => { mergeState.selectingTarget = true; renderGraph(); });
    dom.connectTool.addEventListener('click', () => connectState.active ? cancelConnectMode() : startConnectMode());
    $('#connect-cancel').addEventListener('click', cancelConnectMode);
    dom.connectReset.addEventListener('click', resetConnectSource);
    dom.insertStoryNode.addEventListener('click', () => { const line = selectedLine(); if (line) insertNodeOnLine(line.id, 'story'); });
    dom.insertValueNode.addEventListener('click', () => { const line = selectedLine(); if (line) insertNodeOnLine(line.id, 'value'); });
    dom.notesToggle.addEventListener('click', () => {
      const notes = ensureViewSettings().notes;
      notes.enabled = !notes.enabled;
      markDirty(); refresh({ sidebar: false });
      toast(notes.enabled ? `已在节点${{ top: '上方', right: '右侧', bottom: '下方', left: '左侧' }[notes.position]}显示备注。` : '已隐藏画布备注。');
    });
    dom.notesPosition.addEventListener('change', event => {
      const position = event.target.value;
      if (!['top', 'right', 'bottom', 'left'].includes(position)) return;
      ensureViewSettings().notes.position = position;
      markDirty(); refresh({ sidebar: false });
    });
    dom.themeTool.addEventListener('click', () => {
      dom.themePanel.hidden = !dom.themePanel.hidden;
      if (!dom.themePanel.hidden) renderThemePanel();
      updateToolbar();
    });
    dom.themePanel.addEventListener('click', event => {
      const savedApply = event.target.closest('[data-saved-theme-apply]');
      if (savedApply) { setSavedThemePreset(savedApply.dataset.savedThemeApply); return; }
      const savedUpdate = event.target.closest('[data-saved-theme-update]');
      if (savedUpdate) { updateSavedThemePreset(savedUpdate.dataset.savedThemeUpdate); return; }
      const savedDelete = event.target.closest('[data-saved-theme-delete]');
      if (savedDelete) { deleteSavedThemePreset(savedDelete.dataset.savedThemeDelete); return; }
      const presetButton = event.target.closest('[data-theme-preset]');
      if (presetButton) { setThemePreset(presetButton.dataset.themePreset); return; }
      const actionButton = event.target.closest('[data-theme-action]');
      if (!actionButton) return;
      if (actionButton.dataset.themeAction === 'close') {
        dom.themePanel.hidden = true;
        updateToolbar();
      } else if (actionButton.dataset.themeAction === 'reset') setThemePreset('midnight');
      else if (actionButton.dataset.themeAction === 'save-preset') saveNamedThemePreset();
    });
    dom.themePanel.addEventListener('input', event => {
      const colorInput = event.target.closest('[data-theme-color]');
      if (colorInput) setCustomThemeColor(colorInput.dataset.themeColor, colorInput.value);
    });
    dom.themePanel.addEventListener('change', event => {
      if (event.target.matches('#branch-colors-enabled')) setBranchColorMode(event.target.checked);
    });
    dom.themePanel.addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.target.matches('#theme-preset-name')) {
        event.preventDefault();
        saveNamedThemePreset();
      }
    });

    dom.searchInput.addEventListener('input', () => { searchActiveIndex = 0; showSearchResults(); });
    dom.searchInput.addEventListener('focus', showSearchResults);
    dom.searchInput.addEventListener('keydown', event => {
      const results = [...dom.searchResults.querySelectorAll('[data-search-node]')];
      if (event.key === 'ArrowDown' && results.length) { event.preventDefault(); searchActiveIndex = (searchActiveIndex + 1) % results.length; showSearchResults(); }
      if (event.key === 'ArrowUp' && results.length) { event.preventDefault(); searchActiveIndex = (searchActiveIndex - 1 + results.length) % results.length; showSearchResults(); }
      if (event.key === 'Enter' && results[searchActiveIndex]) { event.preventDefault(); chooseSearchNode(results[searchActiveIndex].dataset.searchNode); }
      if (event.key === 'Escape') { dom.searchResults.hidden = true; dom.searchInput.blur(); }
    });
    dom.searchResults.addEventListener('click', event => {
      const result = event.target.closest('[data-search-node]');
      if (result) chooseSearchNode(result.dataset.searchNode);
    });
    document.addEventListener('pointerdown', event => {
      if (!event.target.closest('.search-wrap')) dom.searchResults.hidden = true;
      if (!dom.themePanel.hidden && !event.target.closest('#theme-panel, #theme-tool')) {
        dom.themePanel.hidden = true;
        updateToolbar();
      }
    });

    dom.dialogCancel.addEventListener('click', () => closeDialog(false));
    dom.dialogConfirm.addEventListener('click', () => closeDialog(true));
    dom.dialogBackdrop.addEventListener('click', event => { if (event.target === dom.dialogBackdrop) closeDialog(false); });

    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject('manual'); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); dom.searchInput.focus(); dom.searchInput.select(); }
      if (event.key === 'Escape' && !dom.themePanel.hidden) { dom.themePanel.hidden = true; updateToolbar(); }
      else if (event.key === 'Escape' && !dom.dialogBackdrop.hidden) closeDialog(false);
      else if (event.key === 'Escape' && nodeMoveState.active) setNodeMoveMode(false);
      else if (event.key === 'Escape' && connectState.active) cancelConnectMode();
      else if (event.key === 'Escape' && mergeState.active) cancelMergeMode();
    });

    window.addEventListener('resize', () => { if (project.nodes.length === 1) fitView(); });
    window.addEventListener('beforeunload', () => {
      webMcpLifecycle.abort();
      if (!loaded || !dirty || !navigator.sendBeacon) return;
      navigator.sendBeacon('/api/save', new Blob([JSON.stringify({ reason: 'close', project })], { type: 'application/json' }));
    });
  }

  bindGlobalEvents();
  loadProject();
  setInterval(() => { if (loaded) saveProject('autosave', true); }, 5 * 60 * 1000);
})();
