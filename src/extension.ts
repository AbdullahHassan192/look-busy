import * as vscode from 'vscode';
import { LookBusyController } from './lookBusyController';
import { readSettings } from './settings';

const ACTIVE_CONTEXT_KEY = 'lookBusy.active';

export function activate(context: vscode.ExtensionContext) {
	const controller = new LookBusyController();
	const startStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	startStatusBarItem.text = '$(play) Start Looking Busy';
	startStatusBarItem.tooltip = 'Start a Look Busy workspace session';
	startStatusBarItem.command = 'look-busy.start';

	const updateStatusBarVisibility = () => {
		if (controller.hasSession || !readSettings().showStatusBarButton) {
			startStatusBarItem.hide();
			return;
		}

		startStatusBarItem.show();
	};

	updateStatusBarVisibility();
	void vscode.commands.executeCommand('setContext', ACTIVE_CONTEXT_KEY, false);

	context.subscriptions.push(
		controller,
		startStatusBarItem,
		controller.onDidChangeSessionActive(() => {
			updateStatusBarVisibility();
		}),
		vscode.workspace.onDidChangeConfiguration((event) => {
			if (event.affectsConfiguration('lookBusy')) {
				controller.refreshSettings();
				updateStatusBarVisibility();
			}
		}),
		vscode.commands.registerCommand('look-busy.start', async () => {
			await controller.start();
		}),
		vscode.commands.registerCommand('look-busy.panic', async () => {
			await controller.panic();
		}),
		vscode.commands.registerCommand('look-busy.injectText', async (args: { text?: string } | undefined) => {
			await controller.injectText(args?.text ?? '');
		}),
		vscode.commands.registerCommand('look-busy.blockEdit', async (args: { action?: string } | undefined) => {
			await controller.blockEdit(args?.action);
		}),
		vscode.commands.registerCommand('type', async (args: { text?: string } | undefined) => {
			await controller.routeType(args?.text ?? '');
		})
	);
}

export function deactivate() {
	return;
}