import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export interface UrlItem {
  url: string;
  external?: boolean; // true = open in system default browser
}

export interface ProgramItem {
  path: string;
  args?: string; // args as single string
}

export interface TerminalProfile {
  name: string;
  path: string;
  args?: string[];
}

export interface CommandData {
  name: string;
  group?: string;
  commands?: string[];
  autoClose?: boolean; // close terminal after commands finish
  externalTerminal?: boolean; // run in external terminal window
  terminalProfile?: string; // name of terminal profile to use (e.g., "PowerShell", "Command Prompt", "Git Bash")
  runAsAdmin?: boolean; // run as administrator (Windows only)
  env?: { [key: string]: string }; // environment variables
  urls?: UrlItem[];
  url?: string; // deprecated, for backward compatibility
  programs?: ProgramItem[]; // array of programs to launch in parallel
  program?: string; // deprecated, for backward compatibility
  args?: string[]; // deprecated, for backward compatibility
}

// Get available terminal profiles from system
export function getTerminalProfiles(): TerminalProfile[] {
  const profiles: TerminalProfile[] = [];

  if (process.platform === 'win32') {
    // Windows terminals
    const fs = require('fs');
    const path = require('path');

    // Command Prompt - always available
    profiles.push({ name: 'Command Prompt', path: 'cmd.exe', args: ['/k'] });

    // PowerShell - always available on modern Windows
    profiles.push({ name: 'PowerShell', path: 'powershell.exe', args: ['-NoExit', '-Command'] });

    // PowerShell 7+ (pwsh)
    const pwshPaths = [
      path.join(process.env.ProgramFiles || '', 'PowerShell', '7', 'pwsh.exe'),
      path.join(process.env['ProgramFiles(x86)'] || '', 'PowerShell', '7', 'pwsh.exe'),
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'pwsh.exe')
    ];
    for (const p of pwshPaths) {
      if (fs.existsSync(p)) {
        profiles.push({ name: 'PowerShell 7', path: p, args: ['-NoExit', '-Command'] });
        break;
      }
    }

    // Git Bash
    const gitBashPaths = [
      path.join(process.env.ProgramFiles || '', 'Git', 'bin', 'bash.exe'),
      path.join(process.env['ProgramFiles(x86)'] || '', 'Git', 'bin', 'bash.exe'),
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe'
    ];
    for (const p of gitBashPaths) {
      if (fs.existsSync(p)) {
        profiles.push({ name: 'Git Bash', path: p, args: ['-c'] });
        break;
      }
    }

    // Windows Terminal (if installed, use 'wt' command)
    const wtPaths = [
      path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WindowsApps', 'wt.exe')
    ];
    for (const p of wtPaths) {
      if (fs.existsSync(p)) {
        profiles.push({ name: 'Windows Terminal', path: 'wt', args: ['-d', '.', 'cmd', '/k'] });
        break;
      }
    }
  } else if (process.platform === 'darwin') {
    // macOS terminals
    profiles.push({ name: 'Terminal', path: 'Terminal.app', args: [] });
    profiles.push({ name: 'iTerm2', path: 'iTerm.app', args: [] });
  } else {
    // Linux terminals
    profiles.push({ name: 'GNOME Terminal', path: 'gnome-terminal', args: ['--'] });
    profiles.push({ name: 'Konsole', path: 'konsole', args: ['-e'] });
    profiles.push({ name: 'xterm', path: 'xterm', args: ['-e'] });
    profiles.push({ name: 'xfce4-terminal', path: 'xfce4-terminal', args: ['-e'] });
  }

  return profiles;
}

interface ConfigFile {
  commands: CommandData[];
}

export type TreeItem = GroupItem | CommandItem;

export class GroupItem extends vscode.TreeItem {
  constructor(
    public readonly groupPath: string,
    isExpanded: boolean = false,  // Default to collapsed
    commandCount?: number  // Number of commands in this group (including subgroups)
  ) {
    const parts = groupPath.split('/');
    const name = parts[parts.length - 1];
    super(name, isExpanded ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'groupItem';
    // Blue colored icon for groups (changes based on state)
    this.iconPath = new vscode.ThemeIcon(
      isExpanded ? 'folder-opened' : 'folder',
      new vscode.ThemeColor('charts.blue')
    );
    // Show command count in description
    if (commandCount !== undefined && commandCount > 0) {
      this.description = `${commandCount}`;
    }
  }
}

export class CommandItem extends vscode.TreeItem {
  constructor(
    public readonly data: CommandData,
    public readonly index: number
  ) {
    super(data.name, vscode.TreeItemCollapsibleState.None);

    // Build tooltip
    const tooltipParts: string[] = [];
    if (data.commands?.length) {
      tooltipParts.push(...data.commands);
    }
    // Support both old url and new urls array
    const urls = data.urls || (data.url ? [{ url: data.url }] : []);
    if (urls.length) {
      for (const u of urls) {
        tooltipParts.push(`🔗 ${u.url}${u.external ? ' (external)' : ''}`);
      }
    }
    // Show programs (support both new array and deprecated single program)
    const programs = data.programs || (data.program ? [{ path: data.program, args: Array.isArray(data.args) ? data.args.join(' ') : data.args }] : []);
    for (const prog of programs) {
      const argsStr = prog.args ? ' ' + prog.args : '';
      tooltipParts.push(`⚙️ ${prog.path}${argsStr}`);
    }
    this.tooltip = tooltipParts.join('\n');

    this.contextValue = 'commandItem';

    // Choose icon based on type
    const hasUrls = urls.length > 0;
    if (hasUrls && !data.commands?.length) {
      this.iconPath = new vscode.ThemeIcon('link-external');
    } else if (data.commands?.length && hasUrls) {
      this.iconPath = new vscode.ThemeIcon('run-all');
    } else {
      this.iconPath = new vscode.ThemeIcon('terminal');
    }
  }
}

const MIME_TYPE = 'application/vnd.code.tree.cmdrunlist';

export class ListProvider implements vscode.TreeDataProvider<TreeItem>, vscode.TreeDragAndDropController<TreeItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeItem | undefined | void> =
    new vscode.EventEmitter<TreeItem | undefined | void>();

  readonly onDidChangeTreeData: vscode.Event<TreeItem | undefined | void> =
    this._onDidChangeTreeData.event;

  // Drag and Drop
  readonly dropMimeTypes = [MIME_TYPE];
  readonly dragMimeTypes = [MIME_TYPE];

  private commands: CommandData[] = [];
  private fileWatcher: vscode.FileSystemWatcher | undefined;
  private expandedGroups: Set<string> = new Set();
  private context: vscode.ExtensionContext | undefined;
  private searchFilter: string = '';

  constructor() {
    this.loadCommands();
    this.setupFileWatcher();
  }

  setContext(context: vscode.ExtensionContext): void {
    this.context = context;
    // Load expanded state from storage
    const saved = context.workspaceState.get<string[]>('cmdrun.expandedGroups', []);
    this.expandedGroups = new Set(saved);
  }

  private saveExpandedState(): void {
    if (this.context) {
      this.context.workspaceState.update('cmdrun.expandedGroups', Array.from(this.expandedGroups));
    }
  }

  setGroupExpanded(groupPath: string, expanded: boolean): void {
    if (expanded) {
      this.expandedGroups.add(groupPath);
    } else {
      this.expandedGroups.delete(groupPath);
    }
    this.saveExpandedState();
  }

  isGroupExpanded(groupPath: string): boolean {
    return this.expandedGroups.has(groupPath);
  }

  // Search filter methods
  setSearchFilter(filter: string): void {
    this.searchFilter = filter.toLowerCase().trim();
    this.refresh();
  }

  getSearchFilter(): string {
    return this.searchFilter;
  }

  clearSearch(): void {
    this.searchFilter = '';
    this.refresh();
  }

  // Check if command matches search filter
  private matchesSearch(cmd: CommandData): boolean {
    if (!this.searchFilter) {
      return true;
    }
    // Search in name
    if (cmd.name.toLowerCase().includes(this.searchFilter)) {
      return true;
    }
    // Search in group
    if (cmd.group && cmd.group.toLowerCase().includes(this.searchFilter)) {
      return true;
    }
    // Search in commands
    if (cmd.commands?.some(c => c.toLowerCase().includes(this.searchFilter))) {
      return true;
    }
    // Search in URLs
    const urls = cmd.urls || (cmd.url ? [{ url: cmd.url }] : []);
    if (urls.some(u => u.url.toLowerCase().includes(this.searchFilter))) {
      return true;
    }
    // Search in programs
    const programs = cmd.programs || (cmd.program ? [{ path: cmd.program }] : []);
    if (programs.some(p => p.path.toLowerCase().includes(this.searchFilter))) {
      return true;
    }
    return false;
  }

  // Drag: store the dragged item (commands or groups)
  handleDrag(source: readonly TreeItem[], dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): void {
    const commandItems = source.filter((item): item is CommandItem => item instanceof CommandItem);
    const groupItems = source.filter((item): item is GroupItem => item instanceof GroupItem);

    if (commandItems.length > 0) {
      dataTransfer.set(MIME_TYPE, new vscode.DataTransferItem({
        type: 'commands',
        indices: commandItems.map(c => c.index)
      }));
    } else if (groupItems.length > 0) {
      dataTransfer.set(MIME_TYPE, new vscode.DataTransferItem({
        type: 'group',
        groupPath: groupItems[0].groupPath
      }));
    }
  }

  // Drop: move item to new location or reorder
  async handleDrop(target: TreeItem | undefined, dataTransfer: vscode.DataTransfer, token: vscode.CancellationToken): Promise<void> {
    const transferItem = dataTransfer.get(MIME_TYPE);
    if (!transferItem) {
      return;
    }

    const data = transferItem.value;
    if (!data) {
      return;
    }

    // Handle group drag
    if (data.type === 'group') {
      this.handleGroupDrop(data.groupPath, target);
      return;
    }

    // Handle command drag
    const sourceIndices: number[] = data.indices;
    if (!sourceIndices || sourceIndices.length === 0) {
      return;
    }

    const sourceIndex = sourceIndices[0];
    const sourceCmd = this.commands[sourceIndex];
    if (!sourceCmd) {
      return;
    }

    // Determine target group and position
    let targetGroup: string | undefined;
    let targetIndex: number = -1;

    if (target instanceof GroupItem) {
      targetGroup = target.groupPath;
      // Find first item in this group to insert before
      targetIndex = this.commands.findIndex(c => c.group === targetGroup || (c.group && c.group.startsWith(targetGroup + '/')));
      if (targetIndex === -1) {
        targetIndex = this.commands.length;
      }
    } else if (target instanceof CommandItem) {
      targetGroup = target.data.group;
      targetIndex = target.index;
    }
    // If dropped on root (target undefined), remove group and move to end
    if (target === undefined) {
      targetGroup = undefined;
      targetIndex = this.commands.findIndex(c => !c.group);
      if (targetIndex === -1) {
        targetIndex = this.commands.length;
      }
    }

    // If same group - reorder
    if (sourceCmd.group === targetGroup && targetIndex !== -1) {
      const [removed] = this.commands.splice(sourceIndex, 1);
      const adjustedTarget = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
      this.commands.splice(adjustedTarget, 0, removed);
    } else {
      // Move to different group
      sourceCmd.group = targetGroup;
      if (targetIndex !== -1 && targetIndex !== sourceIndex) {
        const [removed] = this.commands.splice(sourceIndex, 1);
        const adjustedTarget = sourceIndex < targetIndex ? targetIndex - 1 : targetIndex;
        this.commands.splice(adjustedTarget, 0, removed);
      }
    }

    this.saveCommands();
    this.refresh();
  }

  // Handle dropping a group onto another group or root
  private handleGroupDrop(sourceGroupPath: string, target: TreeItem | undefined): void {
    // Get all commands in source group (and subgroups)
    const sourceCommands = this.commands.filter(c =>
      c.group === sourceGroupPath || (c.group && c.group.startsWith(sourceGroupPath + '/'))
    );

    if (sourceCommands.length === 0) {
      return;
    }

    // Determine target position
    let targetIndex = -1;

    if (target instanceof GroupItem) {
      // Find first command of target group
      targetIndex = this.commands.findIndex(c =>
        c.group === target.groupPath || (c.group && c.group.startsWith(target.groupPath + '/'))
      );
    } else if (target instanceof CommandItem) {
      targetIndex = target.index;
    } else {
      // Dropped on root - move to end of ungrouped or end of array
      targetIndex = this.commands.findIndex(c => !c.group);
      if (targetIndex === -1) {
        targetIndex = this.commands.length;
      }
    }

    if (targetIndex === -1) {
      targetIndex = this.commands.length;
    }

    // Get indices of source commands (sorted descending for safe removal)
    const sourceIndices = this.commands
      .map((c, i) => ({ cmd: c, idx: i }))
      .filter(item => item.cmd.group === sourceGroupPath || (item.cmd.group && item.cmd.group.startsWith(sourceGroupPath + '/')))
      .map(item => item.idx)
      .sort((a, b) => b - a);

    // Remove source commands from their positions
    const removed: CommandData[] = [];
    for (const idx of sourceIndices) {
      removed.unshift(this.commands.splice(idx, 1)[0]);
    }

    // Adjust target index if sources were before target
    const sourcesBeforeTarget = sourceIndices.filter(idx => idx < targetIndex).length;
    const adjustedTarget = targetIndex - sourcesBeforeTarget;

    // Insert at new position
    this.commands.splice(adjustedTarget, 0, ...removed);

    this.saveCommands();
    this.refresh();
  }

  private getConfigPath(): string | undefined {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return undefined;
    }
    return path.join(workspaceFolder.uri.fsPath, '.vscode', 'cmdrun.json');
  }

  private setupFileWatcher(): void {
    const configPath = this.getConfigPath();
    if (!configPath) {
      return;
    }

    const pattern = new vscode.RelativePattern(
      path.dirname(configPath),
      'cmdrun.json'
    );

    this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);
    this.fileWatcher.onDidChange(() => {
      this.loadCommands();
      this.refresh();
    });
    this.fileWatcher.onDidCreate(() => {
      this.loadCommands();
      this.refresh();
    });
    this.fileWatcher.onDidDelete(() => {
      this.commands = [];
      this.refresh();
    });
  }

  private loadCommands(): void {
    const configPath = this.getConfigPath();
    if (!configPath) {
      this.commands = [];
      return;
    }

    try {
      if (fs.existsSync(configPath)) {
        const content = fs.readFileSync(configPath, 'utf-8');
        const config: ConfigFile = JSON.parse(content);
        this.commands = config.commands || [];
      } else {
        this.commands = [];
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Error reading cmdrun.json: ${error}`);
      this.commands = [];
    }
  }

  private saveCommands(): void {
    const configPath = this.getConfigPath();
    if (!configPath) {
      vscode.window.showErrorMessage('No workspace folder open');
      return;
    }

    try {
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const config: ConfigFile = { commands: this.commands };
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
      vscode.window.showErrorMessage(`Error saving cmdrun.json: ${error}`);
    }
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  // Required for reveal() to work with nested items
  getParent(element: TreeItem): TreeItem | undefined {
    if (element instanceof GroupItem) {
      const parts = element.groupPath.split('/');
      if (parts.length > 1) {
        parts.pop();
        return new GroupItem(parts.join('/'));
      }
    }
    if (element instanceof CommandItem && element.data.group) {
      return new GroupItem(element.data.group);
    }
    return undefined;
  }

  getChildren(element?: TreeItem): Thenable<TreeItem[]> {
    if (!element) {
      // Root level: get top-level groups and ungrouped commands
      return Promise.resolve(this.getRootItems());
    }

    if (element instanceof GroupItem) {
      // Get children of this group
      return Promise.resolve(this.getGroupChildren(element.groupPath));
    }

    return Promise.resolve([]);
  }

  // Count commands in a group (including all subgroups)
  private getGroupCommandCount(groupPath: string, commandsList?: CommandData[]): number {
    const cmds = commandsList || this.commands;
    return cmds.filter(c =>
      c.group === groupPath || (c.group && c.group.startsWith(groupPath + '/'))
    ).length;
  }

  private getRootItems(): TreeItem[] {
    const items: TreeItem[] = [];
    const topLevelGroups: string[] = [];
    const seenGroups = new Set<string>();

    // Get filtered commands
    const filteredCommands = this.searchFilter
      ? this.commands.filter(cmd => this.matchesSearch(cmd))
      : this.commands;

    // Collect top-level groups in order of first appearance (only from filtered commands)
    for (const cmd of filteredCommands) {
      if (cmd.group) {
        const topGroup = cmd.group.split('/')[0];
        if (!seenGroups.has(topGroup)) {
          seenGroups.add(topGroup);
          topLevelGroups.push(topGroup);
        }
      }
    }

    // Add group items (in order of first appearance, not alphabetically)
    for (const group of topLevelGroups) {
      const count = this.getGroupCommandCount(group, filteredCommands);
      // When searching, expand all groups to show results
      const isExpanded = this.searchFilter ? true : this.isGroupExpanded(group);
      items.push(new GroupItem(group, isExpanded, count));
    }

    // Add ungrouped commands (in original order)
    this.commands.forEach((cmd, index) => {
      if (!cmd.group && this.matchesSearch(cmd)) {
        items.push(new CommandItem(cmd, index));
      }
    });

    return items;
  }

  private getGroupChildren(groupPath: string): TreeItem[] {
    const items: TreeItem[] = [];
    const subGroups: string[] = [];
    const seenSubGroups = new Set<string>();
    const prefix = groupPath + '/';

    // Get filtered commands for counting
    const filteredCommands = this.searchFilter
      ? this.commands.filter(cmd => this.matchesSearch(cmd))
      : this.commands;

    // Find subgroups and commands in this group (in order of appearance)
    this.commands.forEach((cmd, index) => {
      if (!cmd.group) {
        return;
      }

      // Skip if doesn't match search filter
      if (this.searchFilter && !this.matchesSearch(cmd)) {
        return;
      }

      if (cmd.group === groupPath) {
        // Command directly in this group
        items.push(new CommandItem(cmd, index));
      } else if (cmd.group.startsWith(prefix)) {
        // Command in a subgroup - track subgroup in order of first appearance
        const remaining = cmd.group.slice(prefix.length);
        const nextGroup = remaining.split('/')[0];
        const fullSubGroup = groupPath + '/' + nextGroup;
        if (!seenSubGroups.has(fullSubGroup)) {
          seenSubGroups.add(fullSubGroup);
          subGroups.push(fullSubGroup);
        }
      }
    });

    // Add subgroup items first (in order of first appearance)
    const subGroupItems: TreeItem[] = [];
    for (const subGroup of subGroups) {
      const count = this.getGroupCommandCount(subGroup, filteredCommands);
      // When searching, expand all groups to show results
      const isExpanded = this.searchFilter ? true : this.isGroupExpanded(subGroup);
      subGroupItems.push(new GroupItem(subGroup, isExpanded, count));
    }

    return [...subGroupItems, ...items];
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  // Get all unique group paths for autocomplete
  getAllGroups(): string[] {
    const groups = new Set<string>();
    for (const cmd of this.commands) {
      if (cmd.group) {
        // Add the full path and all parent paths
        const parts = cmd.group.split('/');
        for (let i = 1; i <= parts.length; i++) {
          groups.add(parts.slice(0, i).join('/'));
        }
      }
    }
    return Array.from(groups).sort();
  }

  async expandAll(treeView: vscode.TreeView<TreeItem>): Promise<void> {
    // Get all unique group paths sorted by depth (shallow first)
    const groupPaths = new Set<string>();
    for (const cmd of this.commands) {
      if (cmd.group) {
        // Add all parent paths too
        const parts = cmd.group.split('/');
        for (let i = 1; i <= parts.length; i++) {
          groupPaths.add(parts.slice(0, i).join('/'));
        }
      }
    }

    // Sort by depth (number of /) - shallow first
    const sortedPaths = Array.from(groupPaths).sort((a, b) => {
      const depthA = (a.match(/\//g) || []).length;
      const depthB = (b.match(/\//g) || []).length;
      return depthA - depthB;
    });

    // Reveal each group from shallow to deep
    for (const groupPath of sortedPaths) {
      try {
        const group = new GroupItem(groupPath);
        await treeView.reveal(group, { expand: true, select: false, focus: false });
      } catch (e) {
        // Ignore errors
      }
    }
  }

  async openConfig(): Promise<void> {
    const configPath = this.getConfigPath();
    if (!configPath) {
      vscode.window.showErrorMessage('No workspace folder open');
      return;
    }

    // Create file with example if not exists
    if (!fs.existsSync(configPath)) {
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const example: ConfigFile = {
        commands: [
          {
            name: "Build",
            group: "Server",
            commands: ["dotnet build"]
          },
          {
            name: "Run",
            group: "Server",
            commands: ["dotnet run"]
          },
          {
            name: "Install",
            group: "Client",
            commands: ["npm install"]
          },
          {
            name: "Hello",
            commands: ["echo Hello World"]
          }
        ]
      };
      fs.writeFileSync(configPath, JSON.stringify(example, null, 2), 'utf-8');
    }

    const doc = await vscode.workspace.openTextDocument(configPath);
    await vscode.window.showTextDocument(doc);
  }

  private _extensionUri: vscode.Uri | undefined;

  setExtensionUri(uri: vscode.Uri): void {
    this._extensionUri = uri;
  }

  showAddForm(prefilledGroup?: string): void {
    if (!this._extensionUri) {
      vscode.window.showErrorMessage('Extension not initialized');
      return;
    }

    const { CommandFormPanel } = require('./commandForm');

    // Create prefilled data if group is provided
    const prefilledData = prefilledGroup ? { name: '', group: prefilledGroup } : undefined;
    const existingGroups = this.getAllGroups();

    CommandFormPanel.show(
      this._extensionUri,
      (data: CommandData) => {
        this.commands.push(data);
        this.saveCommands();
        this.refresh();
      },
      prefilledData,
      undefined,
      existingGroups
    );
  }

  showEditForm(item: CommandItem): void {
    if (!this._extensionUri) {
      vscode.window.showErrorMessage('Extension not initialized');
      return;
    }

    const cmd = this.commands[item.index];
    if (!cmd) {
      return;
    }

    const { CommandFormPanel } = require('./commandForm');
    const existingGroups = this.getAllGroups();

    CommandFormPanel.show(
      this._extensionUri,
      (data: CommandData, _isEdit: boolean, editIndex?: number) => {
        if (editIndex !== undefined) {
          this.commands[editIndex] = data;
          this.saveCommands();
          this.refresh();
        }
      },
      cmd,
      item.index,
      existingGroups
    );
  }

  // Keep old methods for backward compatibility
  async addCommand(): Promise<void> {
    this.showAddForm();
  }

  async editCommand(item: CommandItem): Promise<void> {
    this.showEditForm(item);
  }

  async deleteCommand(item: CommandItem): Promise<void> {
    const confirm = await vscode.window.showWarningMessage(
      `Delete command "${item.data.name}"?`,
      { modal: true },
      'Delete'
    );
    if (confirm === 'Delete') {
      this.commands.splice(item.index, 1);
      this.saveCommands();
      this.refresh();
    }
  }

  duplicateCommand(item: CommandItem): void {
    const original = this.commands[item.index];
    if (!original) {
      return;
    }
    // Deep copy the command
    const copy: CommandData = JSON.parse(JSON.stringify(original));
    copy.name = `${original.name} (copy)`;
    // Insert after the original
    this.commands.splice(item.index + 1, 0, copy);
    this.saveCommands();
    this.refresh();
  }

  getCommandData(item: CommandItem): CommandData | undefined {
    return this.commands[item.index];
  }

  // Export config to file
  async exportConfig(): Promise<void> {
    if (this.commands.length === 0) {
      vscode.window.showWarningMessage('No commands to export');
      return;
    }

    const uri = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file('commands.cmdrun.json'),
      filters: {
        'CMDRun Config': ['cmdrun.json', 'json']
      },
      saveLabel: 'Export'
    });

    if (!uri) {
      return;
    }

    try {
      const config: ConfigFile = { commands: this.commands };
      fs.writeFileSync(uri.fsPath, JSON.stringify(config, null, 2), 'utf-8');
      vscode.window.showInformationMessage(`Exported ${this.commands.length} commands to ${path.basename(uri.fsPath)}`);
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to export config: ${error}`);
    }
  }

  // Import config from file
  async importConfig(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectMany: false,
      filters: {
        'CMDRun Config': ['cmdrun.json', 'json']
      },
      openLabel: 'Import'
    });

    if (!uris || uris.length === 0) {
      return;
    }

    try {
      const content = fs.readFileSync(uris[0].fsPath, 'utf-8');
      const imported: ConfigFile = JSON.parse(content);

      if (!imported.commands || !Array.isArray(imported.commands)) {
        vscode.window.showErrorMessage('Invalid config file: missing commands array');
        return;
      }

      // Ask user how to import
      const action = await vscode.window.showQuickPick(
        [
          { label: 'Merge', description: 'Add imported commands to existing ones' },
          { label: 'Replace', description: 'Replace all existing commands' }
        ],
        { placeHolder: `Import ${imported.commands.length} commands` }
      );

      if (!action) {
        return;
      }

      if (action.label === 'Replace') {
        this.commands = imported.commands;
      } else {
        // Merge: add commands that don't exist (by name + group)
        const existingKeys = new Set(
          this.commands.map(c => `${c.group || ''}::${c.name}`)
        );
        let added = 0;
        for (const cmd of imported.commands) {
          const key = `${cmd.group || ''}::${cmd.name}`;
          if (!existingKeys.has(key)) {
            this.commands.push(cmd);
            existingKeys.add(key);
            added++;
          }
        }
        vscode.window.showInformationMessage(`Added ${added} new commands (${imported.commands.length - added} duplicates skipped)`);
      }

      this.saveCommands();
      this.refresh();

      if (action.label === 'Replace') {
        vscode.window.showInformationMessage(`Replaced with ${imported.commands.length} commands`);
      }
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to import config: ${error}`);
    }
  }

  dispose(): void {
    this.fileWatcher?.dispose();
  }
}
