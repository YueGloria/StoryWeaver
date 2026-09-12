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
    connectReset: $('#connect-reset'), insertValueNode: $('#insert-value-node'), zoomLabel: $('#zoom-label'),
    dialogBackdrop: $('#dialog-backdrop'), dialogTitle: $('#dialog-title'), dialogMessage: $('#dialog-message'),
    dialogDetails: $('#dialog-details'), dialogIcon: $('#dialog-icon'), dialogCancel: $('#dialog-cancel'), dialogConfirm: $('#dialog-confirm'),
    toastRegion: $('#toast-region')
  };

  let project = Model.createDefaultProject();
  let calculation = Model.calculate(project);
  let layout = Model.layoutGraph(project);
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

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[character]);
  }

  function escapeXml(value) { return escapeHtml(value).replace(/'/g, '&apos;'); }
  function selectedNode() { return selection.type === 'node' ? Model.getNode(project, selection.id) : null; }
  function selectedLine() { return selection.type === 'line' ? Model.getLine(project, selection.id) : null; }
  function defaultVariableId() { return project.numberDefinitions[0]?.id || ''; }
  function optionList(items, selectedValue, label, value = 'id') {
    return items.map(item => `<option value="${escapeHtml(item[value])}"${item[value] === selectedValue ? ' selected' : ''}>${escapeHtml(item[label])}</option>`).join('');
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
    calculation = Model.calculate(project);
    layout = Model.layoutGraph(project);
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
    if (!result?.reachable) return '<span class="node-value-chip unreachable">数值锁阻断</span>';
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

  function renderGraph() {
    dom.world.style.width = `${layout.width}px`;
    dom.world.style.height = `${layout.height}px`;
    dom.edgeLayer.setAttribute('width', layout.width);
    dom.edgeLayer.setAttribute('height', layout.height);
    dom.edgeLayer.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);

    dom.edgeLayer.innerHTML = project.branchLines.map(line => {
      const source = layout.positions.get(line.sourceId);
      const target = layout.positions.get(line.targetId);
      if (!source || !target) return '';
      const geometry = edgePath(source, target);
      const isSelected = selection.type === 'line' && selection.id === line.id;
      const label = line.label.trim();
      const visibleLabel = label || (isSelected ? '未命名分支线' : '');
      const labelWidth = Model.edgeLabelWidth(visibleLabel);
      const labelY = geometry.midY - 15;
      return `<g class="edge-group${isSelected ? ' selected' : ''}" data-edge-id="${escapeHtml(line.id)}">
        <path class="edge-line" d="${geometry.d}"></path>
        <polygon class="edge-arrow" points="${geometry.endX - 9},${geometry.endY - 5} ${geometry.endX},${geometry.endY} ${geometry.endX - 9},${geometry.endY + 5}"></polygon>
        <path class="edge-hit" data-edge-action="select" d="${geometry.d}"></path>
        ${visibleLabel ? `<g class="edge-label-wrap" data-edge-action="select">
          <rect class="edge-label-bg" x="${geometry.midX - labelWidth / 2}" y="${labelY - 12}" width="${labelWidth}" height="24" rx="7"></rect>
          <text class="edge-label" x="${geometry.midX}" y="${labelY}">${escapeXml(visibleLabel)}</text>
        </g>` : ''}
        <g class="edge-delete" data-edge-action="delete" transform="translate(${geometry.midX} ${geometry.midY + 20})">
          <circle r="10"></circle><text y="1">−</text>
        </g>
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
      const kindLabel = node.kind === 'root' ? '元节点' : node.kind === 'value' ? '数值节点' : '剧情节点';
      const pathLabel = result?.reachable ? `${formatCount(result.pathCount)} 条路径` : '不可进入';
      const connectHint = connectState.active && node.kind === 'story' ? `，点击设为连线${connectState.sourceId ? '终点' : '起点'}` : '';
      return `<article class="${classes.join(' ')}" data-node-id="${escapeHtml(node.id)}" style="left:${position.x}px;top:${position.y}px;width:${position.width}px;min-height:${position.height}px" tabindex="0" aria-label="${escapeHtml(kindLabel)}：${escapeHtml(node.title || '未命名')}${connectHint}">
        <span class="node-kicker"><span>${kindLabel}</span><span class="route-count">${pathLabel}</span></span>
        <strong>${escapeHtml(node.title.trim() || '未命名节点')}</strong>
        <div class="node-values">${nodeValueMarkup(node)}</div>
        <button type="button" class="node-add" data-node-action="add" aria-label="为${escapeHtml(node.title || '此节点')}添加子节点">＋</button>
      </article>`;
    }).join('');

    dom.emptyState.hidden = project.nodes.length > 1;
    updateMergeDock();
    updateConnectDock();
    applyView();
  }

  function valueListMarkup(nodeId) {
    const result = calculation.nodeResults.get(nodeId);
    if (!project.numberDefinitions.length) return '<div class="empty-inline">还没有数值类。请在元节点的“数值定义”中添加。</div>';
    if (!result?.reachable) return '<div class="empty-inline value-warning">当前没有任何路径能进入此节点，因此无法得到数值。</div>';
    return `<div class="value-list">${project.numberDefinitions.map(definition => {
      const range = result.values[definition.id];
      const detail = range?.exact ? '确定数值' : `${result.possibleStateCount} 种可能状态综合后的上下限`;
      return `<div class="value-row"><span>${escapeHtml(definition.name)}</span><strong>${escapeHtml(Model.formatRange(range))}</strong><small>${escapeHtml(detail)}</small></div>`;
    }).join('')}</div>`;
  }

  function effectsMarkup(effects, ownerLabel) {
    if (!project.numberDefinitions.length) return '<div class="empty-inline">请先在元节点定义数值类，才能添加数值变化。</div>';
    const operationOptions = [
      ['add', '增加（＋）'], ['subtract', '减少（−）'], ['multiply', '乘以（×）'], ['divide', '除以（÷）'],
      ['set', '设为（＝）'], ['floorAt', '不低于'], ['capAt', '不高于']
    ];
    const rows = effects.map(effect => {
      const operandControl = effect.operandType === 'variable'
        ? `<select class="compact-select" data-effect-field="operandVariableId">${optionList(project.numberDefinitions, effect.operandVariableId, 'name')}</select>`
        : `<input class="compact-input" data-effect-field="operandValue" type="number" step="any" value="${escapeHtml(effect.operandValue)}">`;
      return `<div class="effect-row" data-effect-id="${escapeHtml(effect.id)}">
        <div class="effect-grid">
          <select class="compact-select" data-effect-field="variableId">${optionList(project.numberDefinitions, effect.variableId, 'name')}</select>
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

  function definitionsMarkup() {
    if (!project.numberDefinitions.length) return '<div class="empty-inline">尚未定义数值。点击右上角加号，例如添加“年龄 = 30”。</div>';
    return `<div class="definition-list">${project.numberDefinitions.map(definition => `<div class="definition-row" data-definition-id="${escapeHtml(definition.id)}">
      <input class="compact-input" data-definition-field="name" value="${escapeHtml(definition.name)}" aria-label="数值名称">
      <input class="compact-input" data-definition-field="initialValue" type="number" step="any" value="${escapeHtml(definition.initialValue)}" aria-label="初始数值">
      <button type="button" class="remove-row" data-definition-action="remove" aria-label="删除${escapeHtml(definition.name)}">×</button>
    </div>`).join('')}</div>`;
  }

  function renderNodeSidebar(node) {
    const isRoot = node.kind === 'root';
    const isValue = node.kind === 'value';
    const result = calculation.nodeResults.get(node.id);
    const kindLabel = isRoot ? '元节点' : isValue ? '数值节点' : '剧情节点';
    dom.sidebar.innerHTML = `<div class="sidebar-inner" data-owner-type="node" data-owner-id="${escapeHtml(node.id)}">
      <div class="sidebar-heading">
        <div><span class="eyebrow">当前选择</span><h2>${kindLabel}</h2></div>
        <span class="status-chip${result?.reachable ? '' : ' danger'}">${isRoot ? '起点' : result?.reachable ? `${formatCount(result.pathCount)} 条路径` : '不可达'}</span>
      </div>
      <label class="field"><span>节点名称</span><input id="node-title-input" data-node-field="title" maxlength="120" value="${escapeHtml(node.title)}" autocomplete="off"></label>
      <label class="field"><span>备注</span><textarea data-node-field="notes" placeholder="记录剧情背景、对白、条件或设计意图……">${escapeHtml(node.notes)}</textarea></label>
      ${isRoot ? `<section class="section">
        <div class="section-title"><div><h3>数值定义</h3><p>数值类只能在元节点添加、修改或删除</p></div><button type="button" class="mini-button accent" data-definition-action="add">＋ 添加</button></div>
        ${definitionsMarkup()}
      </section>` : ''}
      ${isValue ? `<section class="section" data-effect-owner="node">
        <div class="section-title"><div><h3>节点数值变化</h3><p>进入这个节点后自动执行，不会新增剧情分支</p></div></div>
        ${effectsMarkup(node.effects, '这个数值节点')}
      </section>` : ''}
      <section class="section">
        <div class="section-title"><div><h3>${isRoot ? '初始数值' : '到达后的数值'}</h3><p>${isRoot ? '所有路径从这些数值开始' : '根据全部有效路径实时计算'}</p></div></div>
        ${valueListMarkup(node.id)}
      </section>
      ${isValue ? '<div class="sidebar-note">数值节点适合记录“不改变剧情、只调整状态”的事件。它通常由“在分支线上插入数值节点”创建。</div>' : ''}
    </div>`;
    bindNodeSidebar(node);
  }

  function conditionOperandMarkup(condition) {
    if (condition.comparator === 'between' || condition.comparator === 'outside') {
      return `<div class="condition-range"><input class="compact-input condition-value-input" type="number" step="any" data-lock-field="rightValue" value="${escapeHtml(condition.rightValue)}" placeholder="下限" aria-label="范围下限"><input class="compact-input condition-value-input" type="number" step="any" data-lock-field="rangeEnd" value="${escapeHtml(condition.rangeEnd)}" placeholder="上限" aria-label="范围上限"></div>`;
    }
    const valueControl = condition.rightType === 'variable'
      ? `<select class="compact-select" data-lock-field="rightVariableId" aria-label="比较数值类">${optionList(project.numberDefinitions, condition.rightVariableId, 'name')}</select>`
      : `<input class="compact-input condition-value-input" type="number" step="any" data-lock-field="rightValue" value="${escapeHtml(condition.rightValue)}" placeholder="输入数值" aria-label="固定数值">`;
    return `<div class="condition-operand"><select class="compact-select" data-lock-field="rightType" aria-label="比较对象"><option value="number"${condition.rightType === 'number' ? ' selected' : ''}>固定值</option><option value="variable"${condition.rightType === 'variable' ? ' selected' : ''}>数值类</option></select>${valueControl}</div>`;
  }

  function conditionGroupMarkup(group, isRoot = false) {
    const children = group.children.map(child => {
      if (child.type === 'group') return conditionGroupMarkup(child, false);
      const comparatorOptions = [['==', '='], ['!=', '≠'], ['>', '>'], ['>=', '≥'], ['<', '<'], ['<=', '≤'], ['between', '范围内'], ['outside', '范围外']];
      return `<div class="condition-row" data-lock-id="${escapeHtml(child.id)}">
        <button type="button" class="condition-not${child.negate ? ' active' : ''}" data-lock-action="toggle-negate" title="条件取反">非</button>
        <select class="compact-select condition-left" data-lock-field="leftVariableId" aria-label="条件数值类">${optionList(project.numberDefinitions, child.leftVariableId, 'name')}</select>
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
        <div class="variable-pills">${project.numberDefinitions.map(definition => `<button type="button" class="variable-pill" data-variable-name="${escapeHtml(definition.name)}">[${escapeHtml(definition.name)}]</button>`).join('')}</div>
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
    dom.sidebar.innerHTML = `<div class="sidebar-inner" data-owner-type="line" data-owner-id="${escapeHtml(line.id)}">
      <div class="sidebar-heading">
        <div><span class="eyebrow">当前选择</span><h2>分支线</h2><div class="connection-caption">${escapeHtml(source?.title || '未知节点')} → ${escapeHtml(target?.title || '未知节点')}</div></div>
        <span class="status-chip purple">转移规则</span>
      </div>
      <label class="field"><span>分支线文字</span><input id="line-label-input" maxlength="120" value="${escapeHtml(line.label)}" placeholder="显示在分支线上方，例如：选择坦白"></label>
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
        <button type="button" class="mini-button accent full-button" id="sidebar-insert-value">◇ 在此分支线上插入数值节点</button>
        <div class="sidebar-note" style="margin-top:10px">插入后会把当前分支线一分为二，原有文字、数值锁和变化保留在前半段。</div>
      </section>
    </div>`;
    bindLineSidebar(line);
  }

  function renderSidebar() {
    const node = selectedNode();
    const line = selectedLine();
    if (node) renderNodeSidebar(node);
    else if (line) renderLineSidebar(line);
    else {
      selection = { type: 'node', id: project.rootId };
      renderNodeSidebar(Model.getNode(project, project.rootId));
    }
  }

  function updateToolbar() {
    const node = selectedNode();
    const line = selectedLine();
    dom.insertValueNode.disabled = !line;
    dom.insertValueNode.title = line ? '在选中的分支线上插入数值节点' : '请先选中一条分支线';
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

  function bindNodeSidebar(node) {
    const titleInput = dom.sidebar.querySelector('[data-node-field="title"]');
    const notesInput = dom.sidebar.querySelector('[data-node-field="notes"]');
    titleInput?.addEventListener('input', event => { node.title = event.target.value; markDirty(); renderGraph(); updateToolbar(); });
    notesInput?.addEventListener('input', event => { node.notes = event.target.value; markDirty(); });

    dom.sidebar.querySelector('[data-definition-action="add"]')?.addEventListener('click', () => {
      const base = '新数值';
      let name = base;
      let number = 2;
      const names = new Set(project.numberDefinitions.map(item => item.name));
      while (names.has(name)) name = `${base}${number++}`;
      project.numberDefinitions.push({ id: Model.uid('number'), name, initialValue: 0 });
      markDirty(); refresh();
      const inputs = [...dom.sidebar.querySelectorAll('[data-definition-field="name"]')];
      inputs.at(-1)?.select();
    });

    dom.sidebar.querySelectorAll('[data-definition-field]').forEach(control => control.addEventListener('change', event => {
      const row = event.currentTarget.closest('[data-definition-id]');
      const definition = Model.getDefinition(project, row?.dataset.definitionId);
      if (!definition) return;
      const field = event.currentTarget.dataset.definitionField;
      if (field === 'name') {
        const nextName = event.currentTarget.value.trim();
        if (!nextName) { toast('数值名称不能为空。', 'error'); event.currentTarget.value = definition.name; return; }
        if (project.numberDefinitions.some(item => item.id !== definition.id && item.name === nextName)) {
          toast('数值名称不能重复。', 'error'); event.currentTarget.value = definition.name; return;
        }
        const previousName = definition.name;
        definition.name = nextName;
        project.branchLines.forEach(line => { line.lock.expression = Expr.renameVariable(line.lock.expression, previousName, nextName); });
      } else {
        definition.initialValue = Model.finiteNumber(event.currentTarget.value);
      }
      markDirty(); refresh();
    }));

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

    if (node.kind === 'value') {
      const effectsContainer = dom.sidebar.querySelector('[data-effect-owner="node"]');
      if (effectsContainer) bindEffectEditor(effectsContainer, node.effects);
    }
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
    dom.sidebar.querySelector('#sidebar-insert-value')?.addEventListener('click', () => insertValueNodeOnLine(line.id));
  }

  function createChild(parentId) {
    const node = { id: Model.uid('node'), kind: 'story', title: '新节点', notes: '', effects: [], createdAt: Model.nowIso(), sortIndex: project.nodes.length };
    const line = { id: Model.uid('line'), sourceId: parentId, targetId: node.id, label: '', effects: [], lock: Model.newLock(defaultVariableId()), createdAt: Model.nowIso() };
    project.nodes.push(node);
    project.branchLines.push(line);
    selection = { type: 'node', id: node.id };
    markDirty(); refresh();
    requestAnimationFrame(() => { focusNode(node.id); dom.sidebar.querySelector('#node-title-input')?.select(); });
  }

  function insertValueNodeOnLine(lineId) {
    const line = Model.getLine(project, lineId);
    if (!line) return;
    const previousTarget = line.targetId;
    const node = { id: Model.uid('node'), kind: 'value', title: '数值调整', notes: '', effects: [], createdAt: Model.nowIso(), sortIndex: project.nodes.length };
    project.nodes.push(node);
    line.targetId = node.id;
    project.branchLines.push({ id: Model.uid('line'), sourceId: node.id, targetId: previousTarget, label: '', effects: [], lock: Model.newLock(defaultVariableId()), createdAt: Model.nowIso() });
    selection = { type: 'node', id: node.id };
    markDirty(); refresh(); toast('已在分支线上插入数值节点。');
    requestAnimationFrame(() => focusNode(node.id));
  }

  function isEditedNode(node) {
    const defaultTitles = new Set(['新节点', '收束节点', '数值调整']);
    return Boolean(node.notes.trim() || node.effects.length || (!defaultTitles.has(node.title.trim()) && node.kind !== 'root'));
  }

  function isEditedLine(line) { return Boolean(line.label.trim() || line.effects.length || line.lock?.enabled); }

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
    const line = { id: Model.uid('line'), sourceId, targetId: nodeId, label: '', effects: [], lock: Model.newLock(defaultVariableId()), createdAt: Model.nowIso() };
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
    const target = { id: Model.uid('node'), kind: 'story', title: '收束节点', notes: '', effects: [], createdAt: Model.nowIso(), sortIndex: project.nodes.length };
    project.nodes.push(target);
    mergeState.sources.forEach(sourceId => project.branchLines.push({ id: Model.uid('line'), sourceId, targetId: target.id, label: '', effects: [], lock: Model.newLock(defaultVariableId()), createdAt: Model.nowIso() }));
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
      project.branchLines.push({ id: Model.uid('line'), sourceId, targetId, label: '', effects: [], lock: Model.newLock(defaultVariableId()), createdAt: Model.nowIso() });
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
    const matches = project.nodes.filter(node => `${node.title}\n${node.notes}`.toLocaleLowerCase('zh-CN').includes(query)).slice(0, 30);
    searchActiveIndex = matches.length ? Math.min(Math.max(searchActiveIndex, 0), matches.length - 1) : -1;
    dom.searchResults.innerHTML = matches.length ? matches.map((node, index) => {
      const excerpt = node.notes.trim().replace(/\s+/g, ' ') || (node.kind === 'root' ? '元节点' : node.kind === 'value' ? '数值节点' : '剧情节点');
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
      const reason = blockers.length
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
      project = imported;
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
      project = Model.createDefaultProject();
      selection = { type: 'node', id: project.rootId };
      firstFit = true;
      markDirty(); refresh();
      requestAnimationFrame(fitView);
    };
    if (!dirty && project.nodes.length === 1 && !project.numberDefinitions.length) return create();
    showDialog({ title: '新建项目', message: '当前页面内容会被新的空白项目替换。最近一次缓存仍保留在缓存文件夹中。', confirmLabel: '新建空白项目', onConfirm: create });
  }

  async function loadProject() {
    try {
      const response = await fetch('/api/project', { cache: 'no-store' });
      if (!response.ok) throw new Error('无法读取缓存');
      const cached = await response.json();
      project = cached ? Model.normalizeProject(cached) : Model.createDefaultProject();
      setSaveStatus(cached ? '已从最近缓存恢复' : '新的本地项目', cached ? 'saved' : '');
    } catch (error) {
      project = Model.createDefaultProject();
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
          numericClasses: project.numberDefinitions.map(item => ({ id: item.id, name: item.name, initialValue: item.initialValue })),
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
        const node = { id: Model.uid('node'), kind: 'story', title: input.title.trim(), notes: String(input.notes || ''), effects: [], createdAt: Model.nowIso(), sortIndex: project.nodes.length };
        const line = { id: Model.uid('line'), sourceId: input.parentNodeId, targetId: node.id, label: String(input.branchLineText || ''), effects: [], lock: Model.newLock(defaultVariableId()), createdAt: Model.nowIso() };
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
    window.addEventListener('pointerup', event => endDrag(event));
    window.addEventListener('pointercancel', event => endDrag(event, true));
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
      if (event.target.closest('[data-edge-action="delete"]')) pruneBranch(lineId);
      else {
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
    dom.insertValueNode.addEventListener('click', () => { const line = selectedLine(); if (line) insertValueNodeOnLine(line.id); });

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
    });

    dom.dialogCancel.addEventListener('click', () => closeDialog(false));
    dom.dialogConfirm.addEventListener('click', () => closeDialog(true));
    dom.dialogBackdrop.addEventListener('click', event => { if (event.target === dom.dialogBackdrop) closeDialog(false); });

    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveProject('manual'); }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); dom.searchInput.focus(); dom.searchInput.select(); }
      if (event.key === 'Escape' && connectState.active) cancelConnectMode();
      else if (event.key === 'Escape' && mergeState.active) cancelMergeMode();
      else if (event.key === 'Escape' && !dom.dialogBackdrop.hidden) closeDialog(false);
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
