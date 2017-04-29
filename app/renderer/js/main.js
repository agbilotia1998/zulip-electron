'use strict';

const path = require('path');

require(path.resolve(('app/renderer/js/tray.js')));

const DomainUtil = require(path.resolve(('app/renderer/js/utils/domain-util.js')));
const {linkIsInternal, skipImages} = require(path.resolve(('app/main/link-helper')));
const {shell, ipcRenderer} = require('electron');

class ServerManagerView {
	constructor() {
		this.$tabsContainer = document.getElementById('tabs-container');

		const $actionsContainer = document.getElementById('actions-container');
		this.$addServerButton = $actionsContainer.querySelector('#add-action');
		this.$settingsButton = $actionsContainer.querySelector('#settings-action');
		this.$content = document.getElementById('content');

		this.isLoading = false;
		this.settingsTabIndex = -1;
		this.activeTabIndex = -1;
		this.zoomFactors = [];
	}

	init() {
		this.domainUtil = new DomainUtil();
		this.initTabs();
		this.initActions();
		this.registerIpcs();
	}

	initTabs() {
		this.badgeNumberList = [];
		const servers = this.domainUtil.getDomains();
		if (servers.length > 0) {
			for (const server of servers) {
				this.initTab(server);
				this.badgeNumberList.push(0);
			}

			this.activateTab(0);
		} else {
			this.openSettings();
		}
	}

	initTab(tab) {
		const {
			url,
			icon
		} = tab;
		const tabTemplate = tab.template || `
				<div class="tab" domain="${url}">
					<div class="server-tab" style="background-image: url(${icon});"></div>
				</div>`;
		const $tab = this.insertNode(tabTemplate);
		const index = this.$tabsContainer.childNodes.length;
		this.$tabsContainer.appendChild($tab);
		$tab.addEventListener('click', this.activateTab.bind(this, index));
	}

	initWebView(url, index, nodeIntegration = false) {
		const webViewTemplate = `
			<webview 
				id="webview-${index}"
				class="loading"
				src="${url}"
				${nodeIntegration ? 'nodeIntegration' : ''}
				disablewebsecurity
				preload="js/preload.js"
				webpreferences="allowRunningInsecureContent, javascript=yes">
			</webview>
		`;
		const $webView = this.insertNode(webViewTemplate);
		this.$content.appendChild($webView);
		this.isLoading = true;
		$webView.addEventListener('dom-ready', this.endLoading.bind(this, index));
		this.registerListeners($webView, index);
		this.zoomFactors[index] = 1;
	}

	startLoading(url, index) {
		const $activeWebView = document.getElementById(`webview-${this.activeTabIndex}`);
		if ($activeWebView) {
			$activeWebView.classList.add('disabled');
		}
		const $webView = document.getElementById(`webview-${index}`);
		if ($webView === null) {
			this.initWebView(url, index, this.settingsTabIndex === index);
		} else {
			$webView.classList.remove('disabled');
		}
	}

	endLoading(index) {
		const $webView = document.getElementById(`webview-${index}`);
		this.isLoading = false;
		$webView.classList.remove('loading');
		$webView.openDevTools();
	}

	initActions() {
		this.$addServerButton.addEventListener('click', this.openSettings.bind(this));
		this.$settingsButton.addEventListener('click', this.openSettings.bind(this));
	}

	openSettings() {
		if (this.settingsTabIndex !== -1) {
			this.activateTab(this.settingsTabIndex);
			return;
		}
		const url = 'file:///' + path.resolve(('app/renderer/preference.html'));

		const settingsTabTemplate = `
				<div class="tab" domain="${url}">
					<div class="server-tab settings-tab">
						<i class="material-icons md-48">settings</i>
					</div>
				</div>`;
		this.initTab({
			alias: 'Settings',
			url,
			template: settingsTabTemplate
		});

		this.settingsTabIndex = this.$tabsContainer.childNodes.length - 1;
		this.activateTab(this.settingsTabIndex);
	}

	activateTab(index) {
		if (this.isLoading) {
			return;
		}

		if (this.activeTabIndex !== -1) {
			if (this.activeTabIndex === index) {
				return;
			} else {
				this.getTabAt(this.activeTabIndex).classList.remove('active');
			}
		}

		const $tab = this.getTabAt(index);
		$tab.classList.add('active');

		const domain = $tab.getAttribute('domain');
		this.startLoading(domain, index);
		this.activeTabIndex = index;
	}

	insertNode(html) {
		const wrapper = document.createElement('div');
		wrapper.innerHTML = html;
		return wrapper.firstElementChild;
	}

	getTabAt(index) {
		return this.$tabsContainer.childNodes[index];
	}

	registerListeners($webView, index) {
		$webView.addEventListener('new-window', event => {
			const {url} = event;
			const domainPrefix = this.domainUtil.getDomain(this.activeTabIndex).url;
			if (linkIsInternal(domainPrefix, url) && url.match(skipImages) === null) {
				event.preventDefault();
				return $webView.loadURL(url);
			}
			event.preventDefault();
			shell.openExternal(url);
		});

		$webView.addEventListener('page-title-updated', event => {
			const {title} = event;
			if (title.indexOf('Zulip') === -1) {
				return;
			}

			let messageCount = (/\(([0-9]+)\)/).exec(title);
			messageCount = messageCount ? Number(messageCount[1]) : 0;

			this.badgeNumberList[index] = messageCount;

			const sum = this.badgeNumberList.reduce((a, b) => {
				return a + b;
			}, 0);
			ipcRenderer.send('update-badge', sum);
		});
	}

	registerIpcs() {
		ipcRenderer.on('reload', () => {
			const activeWebview = document.getElementById(`webview-${this.activeTabIndex}`);
			activeWebview.reload();
		});

		ipcRenderer.on('back', () => {
			const activeWebview = document.getElementById(`webview-${this.activeTabIndex}`);
			if (activeWebview.canGoBack()) {
				activeWebview.goBack();
			}
		});

		ipcRenderer.on('forward', () => {
			const activeWebview = document.getElementById(`webview-${this.activeTabIndex}`);
			if (activeWebview.canGoForward()) {
				activeWebview.goForward();
			}
		});

		// Handle zooming functionality
		ipcRenderer.on('zoomIn', () => {
			const activeWebview = document.getElementById(`webview-${this.activeTabIndex}`);
			this.zoomFactors[this.activeTabIndex] += 0.1;
			activeWebview.setZoomFactor(this.zoomFactors[this.activeTabIndex]);
		});

		ipcRenderer.on('zoomOut', () => {
			const activeWebview = document.getElementById(`webview-${this.activeTabIndex}`);
			this.zoomFactors[this.activeTabIndex] -= 0.1;
			activeWebview.setZoomFactor(this.zoomFactors[this.activeTabIndex]);
		});

		ipcRenderer.on('zoomActualSize', () => {
			const activeWebview = document.getElementById(`webview-${this.activeTabIndex}`);
			this.zoomFactors[this.activeTabIndex] = 1;
			activeWebview.setZoomFactor(this.zoomFactors[this.activeTabIndex]);
		});

		ipcRenderer.on('log-out', () => {
			const activeWebview = document.getElementById(`webview-${this.activeTabIndex}`);
			activeWebview.executeJavaScript('logout()');
		});

		ipcRenderer.on('shortcut', () => {
			const activeWebview = document.getElementById(`webview-${this.activeTabIndex}`);
			activeWebview.executeJavaScript('shortcut()');
		});

		ipcRenderer.on('open-settings', () => {
			if (this.settingsTabIndex === -1) {
				this.openSettings();
			} else {
				this.activateTab(this.settingsTabIndex);
			}
		});
	}
}

window.onload = () => {
	const serverManagerView = new ServerManagerView();
	serverManagerView.init();
};
