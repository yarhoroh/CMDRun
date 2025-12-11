import * as vscode from 'vscode';
import { CommandData, UrlItem, ProgramItem, getTerminalProfiles, TerminalProfile } from './listProvider';

export class CommandFormPanel {
  public static currentPanel: CommandFormPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private _disposables: vscode.Disposable[] = [];
  private _onSave: (data: CommandData, isEdit: boolean, editIndex?: number) => void;
  private _editIndex?: number;

  private existingGroups: string[] = [];

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    onSave: (data: CommandData, isEdit: boolean, editIndex?: number) => void,
    existingData?: CommandData,
    editIndex?: number,
    existingGroups?: string[]
  ) {
    this._panel = panel;
    this._onSave = onSave;
    this._editIndex = editIndex;
    this.existingGroups = existingGroups || [];

    this._panel.webview.html = this._getHtmlContent(existingData);

    this._panel.webview.onDidReceiveMessage(
      (message) => {
        switch (message.command) {
          case 'save':
            this._onSave(message.data, !!existingData, this._editIndex);
            this._panel.dispose();
            break;
          case 'cancel':
            this._panel.dispose();
            break;
        }
      },
      null,
      this._disposables
    );

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
  }

  public static show(
    extensionUri: vscode.Uri,
    onSave: (data: CommandData, isEdit: boolean, editIndex?: number) => void,
    existingData?: CommandData,
    editIndex?: number,
    existingGroups?: string[]
  ) {
    const column = vscode.ViewColumn.One;

    // If panel exists, update it with new data instead of just revealing
    if (CommandFormPanel.currentPanel) {
      CommandFormPanel.currentPanel._onSave = onSave;
      CommandFormPanel.currentPanel._editIndex = editIndex;
      CommandFormPanel.currentPanel.existingGroups = existingGroups || [];
      CommandFormPanel.currentPanel._panel.title = existingData ? 'Edit Command' : 'Add Command';
      CommandFormPanel.currentPanel._panel.webview.html =
        CommandFormPanel.currentPanel._getHtmlContent(existingData);
      CommandFormPanel.currentPanel._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'cmdrunForm',
      existingData ? 'Edit Command' : 'Add Command',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );

    CommandFormPanel.currentPanel = new CommandFormPanel(
      panel,
      extensionUri,
      onSave,
      existingData,
      editIndex,
      existingGroups
    );
  }

  public dispose() {
    CommandFormPanel.currentPanel = undefined;
    this._panel.dispose();
    while (this._disposables.length) {
      const d = this._disposables.pop();
      if (d) {
        d.dispose();
      }
    }
  }

  private _getHtmlContent(existingData?: CommandData): string {
    const name = existingData?.name || '';
    const group = existingData?.group || '';
    const commands = existingData?.commands || [];
    const autoClose = existingData?.autoClose || false;
    const terminalProfile = existingData?.terminalProfile || '';
    const runAsAdmin = existingData?.runAsAdmin || false;
    const isWindows = process.platform === 'win32';
    // Get available terminal profiles
    const terminalProfiles = getTerminalProfiles();
    // Support both old url and new urls array
    const urls: UrlItem[] = existingData?.urls || (existingData?.url ? [{ url: existingData.url }] : []);
    // Support both old program/args and new programs array
    const programs: ProgramItem[] = existingData?.programs ||
      (existingData?.program ? [{ path: existingData.program, args: Array.isArray(existingData.args) ? existingData.args.join(' ') : existingData.args }] : []);
    // Environment variables
    const envVars: { key: string; value: string }[] = existingData?.env
      ? Object.entries(existingData.env).map(([key, value]) => ({ key, value }))
      : [];

    const commandsJson = JSON.stringify(commands);
    const urlsJson = JSON.stringify(urls);
    const programsJson = JSON.stringify(programs);
    const envVarsJson = JSON.stringify(envVars);
    const terminalProfilesJson = JSON.stringify(terminalProfiles);

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${existingData ? 'Edit' : 'Add'} Command</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      padding: 20px;
      max-width: 700px;
      margin: 0 auto;
    }
    h2 {
      margin-top: 0;
      color: var(--vscode-foreground);
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 10px;
    }
    .form-group { margin-bottom: 16px; }
    label {
      display: block;
      margin-bottom: 6px;
      font-weight: 600;
      color: var(--vscode-foreground);
    }
    .hint {
      font-size: 12px;
      color: var(--vscode-descriptionForeground);
      margin-top: 4px;
    }
    input[type="text"] {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      font-family: inherit;
      font-size: inherit;
    }
    input[type="text"]:focus {
      outline: none;
      border-color: var(--vscode-focusBorder);
    }
    .buttons {
      display: flex;
      gap: 10px;
      margin-top: 24px;
    }
    button {
      padding: 8px 16px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: inherit;
      font-family: inherit;
    }
    button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    button.primary:hover { background: var(--vscode-button-hoverBackground); }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .section {
      margin-top: 20px;
      padding-top: 16px;
      border-top: 1px solid var(--vscode-panel-border);
    }
    .section-title {
      font-size: 13px;
      text-transform: uppercase;
      color: var(--vscode-descriptionForeground);
      margin-bottom: 12px;
    }
    /* Array fields */
    .array-container { margin-bottom: 8px; }
    .array-item {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .array-item input[type="text"] { flex: 1; }
    .array-item textarea {
      flex: 1;
      padding: 6px 10px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      font-family: inherit;
      font-size: inherit;
      line-height: 1.4;
    }
    .array-item textarea:focus {
      outline: 1px solid var(--vscode-focusBorder);
      border-color: var(--vscode-focusBorder);
    }
    .array-item .btn-icon {
      width: 28px;
      height: 28px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      font-size: 16px;
      font-weight: bold;
    }
    .array-item .btn-icon:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .array-item .btn-icon.remove { color: var(--vscode-errorForeground); }
    .btn-add {
      padding: 4px 12px;
      font-size: 13px;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    .btn-add:hover { background: var(--vscode-button-secondaryHoverBackground); }
    /* URL item with checkbox */
    .url-item {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .url-item input[type="text"] { flex: 1; }
    .url-item textarea {
      flex: 1;
      padding: 6px 10px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      font-family: inherit;
      font-size: inherit;
      line-height: 1.4;
    }
    .url-item textarea:focus {
      outline: 1px solid var(--vscode-focusBorder);
      border-color: var(--vscode-focusBorder);
    }
    .url-item label.checkbox-label {
      display: flex;
      align-items: center;
      gap: 4px;
      font-weight: normal;
      font-size: 12px;
      white-space: nowrap;
      cursor: pointer;
    }
    .url-item input[type="checkbox"] {
      width: 14px;
      height: 14px;
      cursor: pointer;
    }
    .url-item .btn-icon {
      width: 28px;
      height: 28px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      font-size: 16px;
      font-weight: bold;
    }
    .url-item .btn-icon:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .url-item .btn-icon.remove { color: var(--vscode-errorForeground); }
    /* Program item with path and args */
    .program-item {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .program-item input[type="text"].program-path { flex: 2; }
    .program-item input[type="text"].program-args { flex: 1; }
    .program-item textarea.program-path {
      flex: 2;
      padding: 6px 10px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      font-family: inherit;
      font-size: inherit;
      line-height: 1.4;
    }
    .program-item textarea.program-args {
      flex: 1;
      padding: 6px 10px;
      border: 1px solid var(--vscode-input-border);
      background: var(--vscode-input-background);
      color: var(--vscode-input-foreground);
      border-radius: 4px;
      font-family: inherit;
      font-size: inherit;
      line-height: 1.4;
    }
    .program-item textarea:focus {
      outline: 1px solid var(--vscode-focusBorder);
      border-color: var(--vscode-focusBorder);
    }
    .program-item .btn-icon {
      width: 28px;
      height: 28px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      font-size: 16px;
      font-weight: bold;
    }
    .program-item .btn-icon:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .program-item .btn-icon.remove { color: var(--vscode-errorForeground); }
    /* Env var item */
    .env-item {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
    }
    .env-item input[type="text"].env-key { flex: 1; }
    .env-item input[type="text"].env-value { flex: 2; }
    .env-item .btn-icon {
      width: 28px;
      height: 28px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
      font-size: 16px;
      font-weight: bold;
    }
    .env-item .btn-icon:hover { background: var(--vscode-button-secondaryHoverBackground); }
    .env-item .btn-icon.remove { color: var(--vscode-errorForeground); }
    /* Custom autocomplete dropdown */
    .autocomplete-wrapper {
      position: relative;
    }
    .autocomplete-dropdown {
      display: none;
      position: absolute;
      top: 100%;
      left: 0;
      right: 0;
      max-height: 200px;
      overflow-y: auto;
      background: var(--vscode-dropdown-background);
      border: 1px solid var(--vscode-dropdown-border);
      border-radius: 4px;
      z-index: 1000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    }
    .autocomplete-dropdown.show { display: block; }
    .autocomplete-item {
      padding: 6px 10px;
      cursor: pointer;
      color: var(--vscode-dropdown-foreground);
    }
    .autocomplete-item:hover,
    .autocomplete-item.selected {
      background: var(--vscode-list-hoverBackground);
    }
    .autocomplete-item.selected {
      background: var(--vscode-list-activeSelectionBackground);
      color: var(--vscode-list-activeSelectionForeground);
    }
  </style>
</head>
<body>
  <h2>${existingData ? 'Edit Command' : 'Add New Command'}</h2>

  <form id="commandForm">
    <div class="form-group">
      <label for="name">Name *</label>
      <input type="text" id="name" value="${this._escapeHtml(name)}" required placeholder="e.g., Build Project">
    </div>

    <div class="form-group">
      <label for="group">Group</label>
      <div class="autocomplete-wrapper">
        <input type="text" id="group" value="${this._escapeHtml(group)}" placeholder="e.g., Server/API" autocomplete="off">
        <div id="groupDropdown" class="autocomplete-dropdown"></div>
      </div>
      <div class="hint">Use / for nesting: Dev/Frontend/React</div>
    </div>

    <div class="form-group">
      <label>Terminal Commands</label>
      <div style="margin-top: 12px;margin-bottom: 18px;">
        <label style="font-size: 12px; color: var(--vscode-descriptionForeground);">Environment Variables (Optional)</label>
        <div id="envContainer" class="array-container" style="margin-top: 4px;"></div>
        <button type="button" class="btn-add" onclick="addEnvVar()">+ Add Variable</button>
      </div>
      <div id="terminalProfileRow" style="margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
        <label for="terminalProfile" style="font-weight: normal; white-space: nowrap;">Terminal:</label>
        <select id="terminalProfile" style="flex: 1; padding: 6px 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px;">
          <option value="">Default (VS Code)</option>
        </select>
      </div>
      <div id="commandsContainer" class="array-container"></div>
<div class="hint">Use <code>{{VAR}}</code> to reference env variables. Auto-converts to !VAR! (CMD), $env:VAR (PS), $VAR (Bash).</div>     
      <div style="display: flex; align-items: center; gap: 12px; margin-top: 6px; flex-wrap: wrap;">
        <button type="button" class="btn-add" onclick="addCommand()">+ Add Command</button>
        <label class="checkbox-label" style="font-weight: normal;">
          <input type="checkbox" id="autoClose" ${autoClose ? 'checked' : ''}>
          Auto Close
        </label>
        ${isWindows ? `<label class="checkbox-label" style="font-weight: normal;">
          <input type="checkbox" id="runAsAdmin" ${runAsAdmin ? 'checked' : ''}>
          Run as Admin
        </label>` : ''}
      </div>
    </div>

    <div class="form-group">
      <label>URLs</label>
      <div id="urlsContainer" class="array-container"></div>
      <button type="button" class="btn-add" onclick="addUrl()">+ Add URL</button>
      <div class="hint">Simple Browser (single tab), External (system browser), Multi-tab (separate VS Code tabs).</div>
    </div>

    <div class="section">
      <div class="section-title">External Programs (Optional)</div>
      <div class="form-group">
        <div id="programsContainer" class="array-container"></div>
        <button type="button" class="btn-add" onclick="addProgram()">+ Add Program</button>
        <div class="hint">Programs will launch in parallel.</div>
      </div>
    </div>

    <div class="buttons">
      <button type="submit" class="primary">${existingData ? 'Save Changes' : 'Add Command'}</button>
      <button type="button" class="secondary" id="cancelBtn">Cancel</button>
    </div>
  </form>

  <script>
    const vscode = acquireVsCodeApi();

    // Initial data
    let commandsData = ${commandsJson};
    let urlsData = ${urlsJson};
    let programsData = ${programsJson};
    let envVarsData = ${envVarsJson};
    const existingGroups = ${JSON.stringify(this.existingGroups)};
    const terminalProfiles = ${terminalProfilesJson};
    const savedTerminalProfile = "${this._escapeHtml(terminalProfile)}";

    // Populate terminal profiles dropdown
    const terminalSelect = document.getElementById('terminalProfile');
    terminalProfiles.forEach(p => {
      const option = document.createElement('option');
      option.value = p.name;
      option.textContent = p.name;
      if (p.name === savedTerminalProfile) {
        option.selected = true;
      }
      terminalSelect.appendChild(option);
    });

    // Group autocomplete
    const groupInput = document.getElementById('group');
    const groupDropdown = document.getElementById('groupDropdown');
    let selectedIndex = -1;

    function showGroupDropdown() {
      const value = groupInput.value.toLowerCase();
      const filtered = existingGroups.filter(g => g.toLowerCase().includes(value));

      if (filtered.length === 0) {
        groupDropdown.classList.remove('show');
        return;
      }

      groupDropdown.innerHTML = filtered.map((g, i) =>
        \`<div class="autocomplete-item\${i === selectedIndex ? ' selected' : ''}" data-value="\${escapeHtml(g)}">\${escapeHtml(g)}</div>\`
      ).join('');
      groupDropdown.classList.add('show');

      // Click handler for items
      groupDropdown.querySelectorAll('.autocomplete-item').forEach(item => {
        item.addEventListener('click', () => {
          groupInput.value = item.dataset.value;
          groupDropdown.classList.remove('show');
          selectedIndex = -1;
        });
      });
    }

    groupInput.addEventListener('focus', showGroupDropdown);
    groupInput.addEventListener('input', () => {
      selectedIndex = -1;
      showGroupDropdown();
    });

    groupInput.addEventListener('keydown', (e) => {
      const items = groupDropdown.querySelectorAll('.autocomplete-item');
      if (!groupDropdown.classList.contains('show') || items.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        updateSelection(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        updateSelection(items);
      } else if (e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault();
        groupInput.value = items[selectedIndex].dataset.value;
        groupDropdown.classList.remove('show');
        selectedIndex = -1;
      } else if (e.key === 'Escape') {
        groupDropdown.classList.remove('show');
        selectedIndex = -1;
      }
    });

    function updateSelection(items) {
      items.forEach((item, i) => {
        item.classList.toggle('selected', i === selectedIndex);
      });
      if (selectedIndex >= 0) {
        items[selectedIndex].scrollIntoView({ block: 'nearest' });
      }
    }

    document.addEventListener('click', (e) => {
      if (!e.target.closest('.autocomplete-wrapper')) {
        groupDropdown.classList.remove('show');
        selectedIndex = -1;
      }
    });

    function renderCommands() {
      const container = document.getElementById('commandsContainer');
      container.innerHTML = '';
      commandsData.forEach((cmd, idx) => {
        const div = document.createElement('div');
        div.className = 'array-item';
        div.innerHTML = \`
          <textarea rows="1" placeholder="e.g., npm install" onchange="updateCommand(\${idx}, this.value)" oninput="autoResizeTextarea(this)" style="resize: vertical; min-height: 28px; overflow: hidden;">\${escapeHtml(cmd)}</textarea>
          <button type="button" class="btn-icon remove" onclick="removeCommand(\${idx})">×</button>
        \`;
        container.appendChild(div);
        // Auto-resize on initial render
        const textarea = div.querySelector('textarea');
        autoResizeTextarea(textarea);
      });
    }

    function autoResizeTextarea(el) {
      el.style.height = 'auto';
      el.style.height = Math.max(28, el.scrollHeight) + 'px';
    }

    function addCommand() {
      commandsData.push('');
      renderCommands();
      // Focus the new textarea
      const textareas = document.querySelectorAll('#commandsContainer textarea');
      if (textareas.length) textareas[textareas.length - 1].focus();
    }

    function updateCommand(idx, value) {
      commandsData[idx] = value;
    }

    function removeCommand(idx) {
      commandsData.splice(idx, 1);
      renderCommands();
    }

    function renderUrls() {
      const container = document.getElementById('urlsContainer');
      container.innerHTML = '';
      urlsData.forEach((item, idx) => {
        const div = document.createElement('div');
        div.className = 'url-item';
        // Determine current mode: 'simple', 'external', or 'webview'
        const mode = item.external ? 'external' : (item.webview ? 'webview' : 'simple');
        div.innerHTML = \`
          <textarea rows="1" placeholder="https://localhost:5000" onchange="updateUrl(\${idx}, 'url', this.value)" oninput="autoResizeTextarea(this)" style="resize: vertical; min-height: 28px; overflow: hidden;">\${escapeHtml(item.url)}</textarea>
          <select onchange="updateUrlMode(\${idx}, this.value)" style="padding: 6px 24px 6px 8px; border: 1px solid var(--vscode-input-border); background: var(--vscode-input-background); color: var(--vscode-input-foreground); border-radius: 4px;">
            <option value="simple" \${mode === 'simple' ? 'selected' : ''}>Simple Browser</option>
            <option value="external" \${mode === 'external' ? 'selected' : ''}>External</option>
            <option value="webview" \${mode === 'webview' ? 'selected' : ''}>Multi-tab</option>
          </select>
          <button type="button" class="btn-icon remove" onclick="removeUrl(\${idx})">×</button>
        \`;
        container.appendChild(div);
        // Auto-resize on initial render
        const textarea = div.querySelector('textarea');
        autoResizeTextarea(textarea);
      });
    }

    function updateUrlMode(idx, mode) {
      urlsData[idx].external = (mode === 'external');
      urlsData[idx].webview = (mode === 'webview');
    }

    function addUrl() {
      urlsData.push({ url: '', external: false, webview: false });
      renderUrls();
      // Focus the new textarea
      const textareas = document.querySelectorAll('#urlsContainer textarea');
      if (textareas.length) textareas[textareas.length - 1].focus();
    }

    function updateUrl(idx, field, value) {
      urlsData[idx][field] = value;
    }

    function removeUrl(idx) {
      urlsData.splice(idx, 1);
      renderUrls();
    }

    function renderPrograms() {
      const container = document.getElementById('programsContainer');
      container.innerHTML = '';
      programsData.forEach((prog, idx) => {
        // args is now stored as string
        const argsStr = Array.isArray(prog.args) ? prog.args.join(' ') : (prog.args || '');
        const div = document.createElement('div');
        div.className = 'program-item';

        const pathInput = document.createElement('textarea');
        pathInput.rows = 1;
        pathInput.className = 'program-path';
        pathInput.placeholder = 'e.g., notepad.exe';
        pathInput.value = prog.path || '';
        pathInput.style.cssText = 'resize: vertical; min-height: 28px; overflow: hidden;';
        pathInput.addEventListener('change', () => updateProgram(idx, 'path', pathInput.value));
        pathInput.addEventListener('input', () => autoResizeTextarea(pathInput));

        const argsInput = document.createElement('textarea');
        argsInput.rows = 1;
        argsInput.className = 'program-args';
        argsInput.placeholder = 'args';
        argsInput.value = argsStr;
        argsInput.style.cssText = 'resize: vertical; min-height: 28px; overflow: hidden;';
        argsInput.addEventListener('change', () => updateProgram(idx, 'args', argsInput.value));
        argsInput.addEventListener('input', () => autoResizeTextarea(argsInput));

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn-icon remove';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => removeProgram(idx));

        div.appendChild(pathInput);
        div.appendChild(argsInput);
        div.appendChild(removeBtn);
        container.appendChild(div);

        // Auto-resize on initial render
        autoResizeTextarea(pathInput);
        autoResizeTextarea(argsInput);
      });
    }

    function addProgram() {
      programsData.push({ path: '', args: '' });
      renderPrograms();
      // Focus the new textarea
      const textareas = document.querySelectorAll('#programsContainer textarea.program-path');
      if (textareas.length) textareas[textareas.length - 1].focus();
    }

    function updateProgram(idx, field, value) {
      if (field === 'path') {
        programsData[idx].path = value;
      } else if (field === 'args') {
        // Store args as string, not array
        programsData[idx].args = value;
      }
    }

    function removeProgram(idx) {
      programsData.splice(idx, 1);
      renderPrograms();
    }

    function renderEnvVars() {
      const container = document.getElementById('envContainer');
      container.innerHTML = '';
      envVarsData.forEach((item, idx) => {
        const div = document.createElement('div');
        div.className = 'env-item';

        const keyInput = document.createElement('input');
        keyInput.type = 'text';
        keyInput.className = 'env-key';
        keyInput.placeholder = 'KEY';
        keyInput.value = item.key || '';
        keyInput.addEventListener('change', () => updateEnvVar(idx, 'key', keyInput.value));

        const valueInput = document.createElement('input');
        valueInput.type = 'text';
        valueInput.className = 'env-value';
        valueInput.placeholder = 'value';
        valueInput.value = item.value || '';
        valueInput.addEventListener('change', () => updateEnvVar(idx, 'value', valueInput.value));

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'btn-icon remove';
        removeBtn.textContent = '×';
        removeBtn.addEventListener('click', () => removeEnvVar(idx));

        div.appendChild(keyInput);
        div.appendChild(valueInput);
        div.appendChild(removeBtn);
        container.appendChild(div);
      });
    }

    function addEnvVar() {
      envVarsData.push({ key: '', value: '' });
      renderEnvVars();
      // Focus the new key input
      const inputs = document.querySelectorAll('#envContainer input.env-key');
      if (inputs.length) inputs[inputs.length - 1].focus();
    }

    function updateEnvVar(idx, field, value) {
      envVarsData[idx][field] = value;
    }

    function removeEnvVar(idx) {
      envVarsData.splice(idx, 1);
      renderEnvVars();
    }

    function escapeHtml(text) {
      const div = document.createElement('div');
      div.textContent = text || '';
      return div.innerHTML;
    }

    // Initial render
    renderCommands();
    renderUrls();
    renderEnvVars();
    renderPrograms();

    document.getElementById('commandForm').addEventListener('submit', (e) => {
      e.preventDefault();

      const name = document.getElementById('name').value.trim();
      if (!name) return;

      const group = document.getElementById('group').value.trim();
      const autoClose = document.getElementById('autoClose').checked;
      const terminalProfile = document.getElementById('terminalProfile').value;
      // External terminal is determined by selecting a specific terminal (not empty/default)
      const externalTerminal = terminalProfile !== '';
      const runAsAdminEl = document.getElementById('runAsAdmin');
      const runAsAdmin = runAsAdminEl ? runAsAdminEl.checked : false;

      // Filter empty commands, urls, and programs
      const filteredCommands = commandsData.map(c => c.trim()).filter(c => c);
      const filteredUrls = urlsData.filter(u => u.url && u.url.trim()).map(u => ({
        url: u.url.trim(),
        ...(u.external ? { external: true } : {}),
        ...(u.webview ? { webview: true } : {})
      }));
      const filteredPrograms = programsData.filter(p => p.path && p.path.trim()).map(p => {
        // Handle args as string (already converted from array in renderPrograms)
        const argsVal = typeof p.args === 'string' ? p.args.trim() : (Array.isArray(p.args) ? p.args.join(' ') : '');
        return {
          path: p.path.trim(),
          ...(argsVal ? { args: argsVal } : {})
        };
      });
      // Filter and convert env vars to object
      const filteredEnv = {};
      envVarsData.forEach(item => {
        const key = item.key?.trim();
        const value = item.value?.trim();
        if (key) {
          filteredEnv[key] = value || '';
        }
      });

      const data = { name };
      if (group) data.group = group;
      if (filteredCommands.length) data.commands = filteredCommands;
      if (autoClose) data.autoClose = true;
      if (externalTerminal) data.externalTerminal = true;
      if (terminalProfile) data.terminalProfile = terminalProfile;
      if (runAsAdmin) data.runAsAdmin = true;
      if (Object.keys(filteredEnv).length) data.env = filteredEnv;
      if (filteredUrls.length) data.urls = filteredUrls;
      if (filteredPrograms.length) data.programs = filteredPrograms;

      vscode.postMessage({ command: 'save', data });
    });

    document.getElementById('cancelBtn').addEventListener('click', () => {
      vscode.postMessage({ command: 'cancel' });
    });

    document.getElementById('name').focus();
  </script>
</body>
</html>`;
  }

  private _escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
