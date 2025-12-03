import * as vscode from 'vscode';
import { ListProvider, CommandItem, GroupItem, UrlItem, getTerminalProfiles } from './listProvider';

export function activate(context: vscode.ExtensionContext) {
  const listProvider = new ListProvider();
  listProvider.setExtensionUri(context.extensionUri);
  listProvider.setContext(context);

  // Register tree with drag and drop support
  const treeView = vscode.window.createTreeView('cmdrunList', {
    treeDataProvider: listProvider,
    dragAndDropController: listProvider,
    canSelectMany: true
  });

  context.subscriptions.push(treeView);

  // Track expand/collapse state
  treeView.onDidExpandElement(e => {
    if (e.element instanceof GroupItem) {
      listProvider.setGroupExpanded(e.element.groupPath, true);
    }
  });
  treeView.onDidCollapseElement(e => {
    if (e.element instanceof GroupItem) {
      listProvider.setGroupExpanded(e.element.groupPath, false);
    }
  });

  // Add command
  const addCommand = vscode.commands.registerCommand('cmdrun.add', () => {
    listProvider.addCommand();
  });

  // Edit command
  const editCommand = vscode.commands.registerCommand('cmdrun.edit', (item: CommandItem) => {
    listProvider.editCommand(item);
  });

  // Delete command
  const deleteCommand = vscode.commands.registerCommand('cmdrun.delete', (item: CommandItem) => {
    listProvider.deleteCommand(item);
  });

  // Run command - opens terminal and/or browser in editor area
  const runCommand = vscode.commands.registerCommand('cmdrun.run', async (item: CommandItem) => {
    const cmdData = listProvider.getCommandData(item);
    if (!cmdData) {
      return;
    }

    // Run terminal commands if present
    if (cmdData.commands?.length) {
      // Different separators for different shells
      const cmdJoined = cmdData.commands.join(' && '); // For CMD and Bash
      const psJoined = cmdData.commands.join('; '); // For PowerShell (sequential execution)

      // External terminal with optional admin elevation (Windows only for admin)
      if (cmdData.externalTerminal) {
        const { exec, spawn } = require('child_process');

        // Get selected terminal profile or use default
        const profiles = getTerminalProfiles();
        const selectedProfile = cmdData.terminalProfile
          ? profiles.find(p => p.name === cmdData.terminalProfile)
          : profiles[0]; // Default to first profile

        if (process.platform === 'win32') {
          const termPath = selectedProfile?.path || 'cmd.exe';
          const isPowerShell = termPath.includes('powershell') || termPath.includes('pwsh');
          const isBash = termPath.includes('bash');
          const isWindowsTerminal = termPath === 'wt' || termPath.includes('wt.exe');

          // Choose correct command format based on shell
          const shellCommands = (isPowerShell && !isWindowsTerminal) ? psJoined : cmdJoined;

          if (cmdData.runAsAdmin) {
            // Run as admin - use PowerShell Start-Process with RunAs verb
            const escapedCmd = shellCommands.replace(/'/g, "''").replace(/"/g, '`"');
            // /k keeps window open, /c closes after command
            const cmdSwitch = cmdData.autoClose ? '/c' : '/k';

            if (isWindowsTerminal) {
              // Windows Terminal with admin - runs cmd inside
              exec(`powershell -Command "Start-Process wt -ArgumentList 'cmd ${cmdSwitch} ${cmdJoined.replace(/'/g, "''")}' -Verb RunAs"`);
            } else if (isPowerShell) {
              // PowerShell with admin
              if (cmdData.autoClose) {
                exec(`powershell -Command "Start-Process ${termPath} -ArgumentList '-Command ${escapedCmd}' -Verb RunAs"`);
              } else {
                exec(`powershell -Command "Start-Process ${termPath} -ArgumentList '-NoExit -Command ${escapedCmd}' -Verb RunAs"`);
              }
            } else if (isBash) {
              // Git Bash with admin
              const bashCmd = cmdJoined.replace(/'/g, "'\\''");
              if (cmdData.autoClose) {
                exec(`powershell -Command "Start-Process '${termPath}' -ArgumentList '-c','${bashCmd}' -Verb RunAs"`);
              } else {
                exec(`powershell -Command "Start-Process '${termPath}' -ArgumentList '-c','${bashCmd}; read' -Verb RunAs"`);
              }
            } else {
              // CMD with admin
              exec(`powershell -Command "Start-Process cmd -ArgumentList '${cmdSwitch} ${cmdJoined.replace(/'/g, "''")}' -Verb RunAs"`);
            }
          } else {
            // Regular external terminal (no admin)
            // /k keeps window open, /c closes after command
            const cmdSwitch = cmdData.autoClose ? '/c' : '/k';
            const psSwitch = cmdData.autoClose ? '-Command' : '-NoExit -Command';

            if (isWindowsTerminal) {
              // Windows Terminal - opens cmd by default
              spawn('wt', ['cmd', cmdSwitch, cmdJoined], { detached: true, stdio: 'ignore', shell: true }).unref();
            } else if (isPowerShell) {
              // PowerShell - use semicolon separator
              if (cmdData.autoClose) {
                spawn('cmd', ['/c', 'start', termPath, '-Command', psJoined], { detached: true, stdio: 'ignore', shell: true }).unref();
              } else {
                spawn('cmd', ['/c', 'start', termPath, '-NoExit', '-Command', psJoined], { detached: true, stdio: 'ignore', shell: true }).unref();
              }
            } else if (isBash) {
              // Git Bash
              if (cmdData.autoClose) {
                spawn('cmd', ['/c', 'start', termPath, '-c', cmdJoined], { detached: true, stdio: 'ignore', shell: true }).unref();
              } else {
                spawn('cmd', ['/c', 'start', termPath, '-c', `${cmdJoined}; read -p 'Press Enter to close...'`], { detached: true, stdio: 'ignore', shell: true }).unref();
              }
            } else {
              // CMD (default)
              spawn('cmd', ['/c', 'start', 'cmd', cmdSwitch, cmdJoined], { detached: true, stdio: 'ignore', shell: true }).unref();
            }
          }
        } else if (process.platform === 'darwin') {
          // macOS: open Terminal.app or iTerm
          const escaped = cmdJoined.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/'/g, "'\\''");
          if (selectedProfile?.name === 'iTerm2') {
            exec(`osascript -e 'tell app "iTerm" to create window with default profile command "${escaped}"'`);
          } else {
            exec(`osascript -e 'tell app "Terminal" to do script "${escaped}"'`);
          }
        } else {
          // Linux - use selected terminal or try common ones
          const escaped = cmdJoined.replace(/"/g, '\\"').replace(/'/g, "'\\''");
          const termPath = selectedProfile?.path || 'gnome-terminal';

          if (termPath === 'gnome-terminal') {
            spawn('gnome-terminal', ['--', 'bash', '-c', `${escaped}; exec bash`], { detached: true, stdio: 'ignore' }).unref();
          } else if (termPath === 'konsole') {
            spawn('konsole', ['-e', 'bash', '-c', `${escaped}; exec bash`], { detached: true, stdio: 'ignore' }).unref();
          } else if (termPath === 'xfce4-terminal') {
            spawn('xfce4-terminal', ['-e', `bash -c '${escaped}; exec bash'`], { detached: true, stdio: 'ignore' }).unref();
          } else if (termPath === 'xterm') {
            spawn('xterm', ['-e', 'bash', '-c', `${escaped}; exec bash`], { detached: true, stdio: 'ignore' }).unref();
          } else {
            // Fallback
            exec(`${termPath} -e bash -c "${escaped}; exec bash"`);
          }
        }
      } else {
        // Internal VS Code terminal (uses PowerShell on Windows by default)
        const terminal = vscode.window.createTerminal({
          name: cmdData.name,
          location: vscode.TerminalLocation.Editor,
          env: cmdData.env // Pass environment variables
        });

        terminal.show();

        // VS Code terminal on Windows uses PowerShell, so use semicolon
        const internalCommands = process.platform === 'win32' ? psJoined : cmdJoined;

        if (cmdData.autoClose) {
          // Platform-specific autoClose handling
          if (process.platform === 'win32') {
            // PowerShell: try/finally to exit even on Ctrl+C
            terminal.sendText(`try { ${psJoined} } finally { exit }`);
          } else {
            // Bash (Linux/Mac): trap for Ctrl+C, then run commands and exit
            terminal.sendText(`trap 'exit' INT; ${cmdJoined}; exit`);
          }
        } else {
          terminal.sendText(internalCommands);
        }
      }
    }

    // Open URLs - with delay between each to avoid race conditions
    const urls: UrlItem[] = cmdData.urls || (cmdData.url ? [{ url: cmdData.url }] : []);
    for (let i = 0; i < urls.length; i++) {
      const urlItem = urls[i];
      // Add delay between URL opens (100ms)
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (urlItem.external === true) {
        // Open in system default browser
        const { exec } = require('child_process');
        const url = urlItem.url;
        if (process.platform === 'win32') {
          exec(`start "" "${url}"`);
        } else if (process.platform === 'darwin') {
          exec(`open "${url}"`);
        } else {
          exec(`xdg-open "${url}"`);
        }
      } else {
        // Open in Simple Browser inside VS Code
        await vscode.commands.executeCommand('simpleBrowser.show', urlItem.url);
      }
    }

    // Launch programs in parallel (support both new array and deprecated single program)
    const programs: { path: string; args?: string | string[] }[] = cmdData.programs ||
      (cmdData.program ? [{ path: cmdData.program, args: cmdData.args }] : []);

    if (programs.length > 0) {
      const { exec } = require('child_process');
      // Launch all programs in parallel
      for (const prog of programs) {
        // args can be string or array
        const argsStr = Array.isArray(prog.args) ? prog.args.join(' ') : (prog.args || '');
        // Quote path if contains spaces, args passed as-is
        const quotedPath = prog.path.includes(' ') ? `"${prog.path}"` : prog.path;
        const fullCmd = argsStr ? `${quotedPath} ${argsStr}` : quotedPath;

        // Use exec to run command - handles quotes properly
        exec(fullCmd, (error: Error | null) => {
          if (error) {
            vscode.window.showErrorMessage(`Failed to launch ${prog.path}: ${error.message}`);
          }
        });
      }
    }
  });

  // Open config file
  const openConfigCommand = vscode.commands.registerCommand('cmdrun.openConfig', () => {
    listProvider.openConfig();
  });

  // Collapse All
  const collapseAllCommand = vscode.commands.registerCommand('cmdrun.collapseAll', () => {
    vscode.commands.executeCommand('workbench.actions.treeView.cmdrunList.collapseAll');
  });

  // Expand All
  const expandAllCommand = vscode.commands.registerCommand('cmdrun.expandAll', () => {
    listProvider.expandAll(treeView);
  });

  // Refresh
  const refreshCommand = vscode.commands.registerCommand('cmdrun.refresh', () => {
    listProvider.refresh();
  });

  // Collapse Group
  const collapseGroupCommand = vscode.commands.registerCommand('cmdrun.collapseGroup', (item: GroupItem) => {
    if (item instanceof GroupItem) {
      treeView.reveal(item, { expand: false, select: false, focus: false });
    }
  });

  // Add to Group
  const addToGroupCommand = vscode.commands.registerCommand('cmdrun.addToGroup', (item: GroupItem) => {
    if (item instanceof GroupItem) {
      listProvider.showAddForm(item.groupPath);
    }
  });

  // Duplicate command
  const duplicateCommand = vscode.commands.registerCommand('cmdrun.duplicate', (item: CommandItem) => {
    listProvider.duplicateCommand(item);
  });

  // Search commands
  const searchCommand = vscode.commands.registerCommand('cmdrun.search', async () => {
    const currentFilter = listProvider.getSearchFilter();
    const filter = await vscode.window.showInputBox({
      prompt: 'Filter commands by name, group, command, URL or program',
      placeHolder: 'Enter filter text...',
      value: currentFilter
    });
    if (filter !== undefined) {
      listProvider.setSearchFilter(filter);
      // Update description and context
      treeView.description = filter ? `🔍 "${filter}"` : '';
      vscode.commands.executeCommand('setContext', 'cmdrun.hasSearchFilter', !!filter);
    }
  });

  // Clear search
  const clearSearchCommand = vscode.commands.registerCommand('cmdrun.clearSearch', () => {
    listProvider.clearSearch();
    treeView.description = '';
    vscode.commands.executeCommand('setContext', 'cmdrun.hasSearchFilter', false);
  });

  // Export config
  const exportCommand = vscode.commands.registerCommand('cmdrun.export', () => {
    listProvider.exportConfig();
  });

  // Import config
  const importCommand = vscode.commands.registerCommand('cmdrun.import', () => {
    listProvider.importConfig();
  });

  context.subscriptions.push(
    addCommand,
    editCommand,
    deleteCommand,
    runCommand,
    openConfigCommand,
    collapseAllCommand,
    expandAllCommand,
    refreshCommand,
    collapseGroupCommand,
    addToGroupCommand,
    duplicateCommand,
    searchCommand,
    clearSearchCommand,
    exportCommand,
    importCommand,
    { dispose: () => listProvider.dispose() }
  );
}

export function deactivate() {}
