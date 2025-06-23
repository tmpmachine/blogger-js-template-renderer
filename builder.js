// @ts-check

// version: 3.8
function appBuilder(options) {

	// # vars
	let $ = document.querySelector.bind(document);
	let devTemplate = null;
	let templateUrl = options?.template;
	let widgets = [];
	let templates = options?.templates ?? {};
	let dataDoc = document;
	let dataMap = [];
	let countMap = 0;
	let downloadableTemplate = null;
	let _globalData = {};
	let _isDevelopment = location.port ? true : false;

	if (_isDevelopment && !options?.template) {
		throw 'template not set';
	}

	// # function

	function readChildData(node, data) {
		let branchNodes = node.querySelectorAll('& > data');

		branchNodes.forEach((branchNode) => readBranchNode(branchNode, data));
	}

	function readChildArray(node, items) {
		let branchNodes = node.querySelectorAll('& > data');
		let data = {};

		branchNodes.forEach((branchNode) => readBranchNode(branchNode, data));

		items.push(data);
	}

	function readBranchNode(branchNode, data) {
		let key = branchNode.slot;

		if (key.endsWith('[]')) {
			let items = [];

			for (let twigNode of branchNode.querySelectorAll('& > div')) {
				readChildArray(twigNode, items);
			}

			data[key.replace('[]', '')] = items;
		} else {
			dataMap[countMap++] = branchNode;
			data[key] = countMap - 1;
		}
	}

	// # load data
	function loadData() {
		let nodes = dataDoc.querySelectorAll('.WidgetData');

		for (let node of nodes) {
			let widget = widgets.find((e) => e.id == node.id);

			if (!widget) {
				widget = {
					id: node.id,
					title: node.content.querySelector('[slot="title"]')?.textContent.trim(),
					sectionId: node.parentElement?.parentElement?.id,
					data: {},
				};
				widgets.push(widget);
			}

			readChildData(node.content.firstElementChild, widget.data);
		}
	}

	// # builder
	const widgetBase = {
		templateSelector: '',
		templadeNode: null,
		isReady: false,
		data: {},
		build() {
			let docFrag = document.createDocumentFragment();
			let templateNode = this.templateNode ?? devTemplate.querySelector(this.templateSelector);

			if (!templateNode) {
				return docFrag;
			}

			let item = this.data;

			let itemEl = (templateNode.content ?? templateNode).cloneNode(true) ?? document.createDocumentFragment();

			removeObsoletes(itemEl);
			removeConditionalWidgets(itemEl, item);

			Object.entries(item).forEach(([key, value]) => {
				if (Array.isArray(value)) {
					itemEl.querySelectorAll(`[data-slot="${key}"]`).forEach((el) => {
						const docFrag = document.createDocumentFragment();
						const templateName = el.dataset.template;

						for (let v of value) {
							let includableData = v;
							const widgetBuilder = Object.create(widgetBase);

							widgetBuilder.data = Object.assign(includableData, _globalData);
							widgetBuilder.templateSelector = `#${templateName}`;

							const childNodes = widgetBuilder.build();

							docFrag.append(...childNodes.childNodes);
						}

						el.replaceChildren(docFrag);
						el.removeAttribute('data-slot');
						el.removeAttribute('data-template');
					});
				} else {
					let mapValue = dataMap[value];

					itemEl.querySelectorAll(`[data-attr-href="${key}"]`).forEach((el) => {
						el.href = mapValue.textContent.trim();
						el.removeAttribute('data-attr-href');
					});
					itemEl.querySelectorAll(`[data-attr-src="${key}"]`).forEach((el) => {
						el.setAttribute('src', mapValue.textContent.trim());
						el.removeAttribute('data-attr-src');
					});
					itemEl.querySelectorAll(`[data-slot="${key}"]`).forEach((el) => {
						el.replaceChildren(...mapValue.cloneNode(true).childNodes);
						el.removeAttribute('data-slot');
					});
				}
			});

			docFrag.append(itemEl);

			return docFrag;
		},
	};

	// # build
	async function build_() {
		if (_isDevelopment) {
			let r = await fetch(templateUrl).then((r) => r.text());
			let docEl = document.createElement('template');
			docEl.innerHTML = r;

			// replace template file
			{
				for (let el of docEl.content.querySelectorAll('file')) {
					let target = el.dataset.targetFile;
					let url = templates[target];

					if (!url) {
						el.remove();
						continue;
					}

					await new Promise((resolve) => {
						fetch(url)
							.then((r) => r.text())
							.then((r) => {
								let docEl = document.createElement('div');
								docEl.innerHTML = r;

								el.insertAdjacentElement('beforebegin', docEl);
								el.remove();
								resolve();
							});
					});
				}
			}

			// replace includables
			{
				// assume includables are always first level template
				// 1. replace includables inside template tags
				let topLevel = docEl;
				for (let templateTag of docEl.content.querySelectorAll('template')) {
					replaceIncludables(topLevel, templateTag);
				}

				// 2. replace includables in top level
				replaceIncludables(topLevel, topLevel);
			}

			let content = docEl.content;
			devTemplate = content;

			downloadableTemplate = docEl.innerHTML;

			fillWidgets();
			$('._app').replaceChildren(content);
		} else {
			let content = $('._appTemplate').content.cloneNode(true);

			$('._appTemplate').remove();

			devTemplate = content.querySelector('.widget-content');

			fillWidgets();
			$('._app').replaceChildren(...devTemplate.childNodes);
		}

		// release from memory
		if (!_isDevelopment) {
			widgets.length = 0;
		}

		this.isReady = true;
	}

	function replaceIncludables(topLevel, parentNode) {
		for (let includeTag of parentNode.content.querySelectorAll('include')) {
			let target = includeTag.getAttribute('name');
			let templateTag = topLevel.content.querySelector(`template[data-includable="${target}"]`)

			// replace include tags inside templates
			// replaceIncludables(docEl, templateTag);

			includeTag.parentNode.insertBefore(templateTag.content.cloneNode(true), includeTag);
			includeTag.remove();
			templateTag.remove();
		}
	}

	function getWidgetType(text) {
		const match = text.match(/^([A-Za-z]+)/);
		const result = match ? match[1] : null;
		return result;
	}

	// # condition
	function removeConditionalWidgets(container = devTemplate, data = {}) {
		let nodes = container.querySelectorAll('[data-b-if]');

		for (const node of nodes) {
			let key = node.dataset.bIf;
			let isInverse = false;

			if (key.startsWith('!')) {
				isInverse = true;
				key = key.slice(1);
			}

			let evalResult = false;
			let dataKey = data[key];

			if (dataKey && dataMap[dataKey]) {
				let dataVal = dataMap[dataKey];
				if (dataVal.dataset?.type == 'boolean') {
					evalResult = JSON.parse(dataVal.textContent);
				} else {
					evalResult = dataVal?.textContent?.trim().length > 0;
				}
			}

			let isCondMet = evalResult;

			if (isInverse) {
				isCondMet = !evalResult;
			}

			if (!isCondMet) {
				node.remove();
			}

			node.removeAttribute('data-b-if');
		}
	}

	// # obsoletes
	function removeObsoletes(container = devTemplate) {
		let nodes = container.querySelectorAll('[data-b-obsolete]');

		for (const node of nodes) {
			node.remove();
			node.removeAttribute('data-b-obsolete');
		}
	}

	// this is the initial process of replacing custom template tags
	// tags: # fill
	function fillWidgets() {
		let globalData = widgets.find((e) => e.id == 'Global')?.data ?? {};
		_globalData = globalData;

		removeObsoletes(devTemplate);
		removeConditionalWidgets(devTemplate, _globalData);
		processSection();
		processWidget();
	}

	// # section
	function processSection() {
		let nodes = devTemplate.querySelectorAll('[data-section]');

		for (let node of nodes) {
			let sectionId = node.dataset.section;
			let sectionContainer = dataDoc.querySelector(`.section#${sectionId}`);

			if (!sectionContainer) {
				continue;
			}

			let sectionNode = sectionContainer.cloneNode(true);
			let widgetNodes = sectionNode.querySelectorAll('& > .widget');

			widgetNodes.forEach((widgetNode) => {
				let instanceId = widgetNode.id;
				let widgetType = getWidgetType(instanceId);
				let markupNode = node.querySelector(`[data-markup=${widgetType}]`);

				if (!markupNode) {
					return;
				}

				let templateId = markupNode.dataset.template;
				let widgetBuilder = Object.create(widgetBase);
				let widgetData = widgets.find((e) => e.id == instanceId);

				widgetBuilder.data = Object.assign(widgetData.data, _globalData);

				widgetBuilder.templateSelector = `template#${templateId}`;

				const childNode = widgetBuilder.build();

				widgetNode.replaceChildren(childNode);
			});

			node.replaceChildren(sectionNode);
		}
	}

	// # widgets
	function processWidget() {
		let nodes = devTemplate.querySelectorAll('[data-widget]');

		for (let node of nodes) {
			let instanceId = node.dataset.widget;
			let widgetType = getWidgetType(instanceId);
			let templateId = node.dataset.template ?? widgetType;
			let widgetData = widgets.find((e) => e.id == instanceId);

			if (!widgetData) {
				console.log(`empty widget slot:`, instanceId);
				continue;
			}

			// apply widget filters
			if (widgetType == 'Blog' && widgetData.data.posts) {
				let filterLabels = node.dataset.filterLabels?.split(',').map((e) => e.trim());
				let maxPostsLimit = parseInt(node.dataset.maxPosts);

				widgetData = JSON.parse(JSON.stringify(widgetData));

				if (filterLabels?.length > 0) {
					widgetData.data.posts = widgetData.data.posts?.filter((e) =>
						e.labels?.some((e) => filterLabels.includes(dataMap[e.name].textContent.trim()))
					);
				}

				if (maxPostsLimit > 0) {
					widgetData.data.posts = widgetData.data.posts.slice(0, maxPostsLimit);
				}
			}
			let widgetBuilder = Object.create(widgetBase);
			widgetBuilder.data = Object.assign(widgetData.data, _globalData);

			widgetBuilder.templateSelector = `template#${templateId}`;

			const childNode = widgetBuilder.build();

			node.replaceChildren(childNode);
			node.removeAttribute('data-widget');
			node.removeAttribute('data-template');
		}
	}

	// # self
	return {
		GetWidgetsData: () => widgets,

		DownloadTemplate() {
			let blob = new Blob([downloadableTemplate], { type: 'text/html' });
			let url = URL.createObjectURL(blob);

			let el = document.createElement('a');
			el.href = url;
			el.target = '_blank';
			el.download = location.pathname.split('/').pop();
			el.onclick = function () {
				el.remove();
			};
			document.body.append(el);
			el.click();
		},

		//  # init
		async init(
			options = {
				dataPath: `/tests/data`,
			}
		) {
			if (!['localhost', '127.0.0.1'].includes(location.hostname)) {
				options.dataPath = options.dataPath.replace('localhost', location.hostname);
			}

			options.dataPath = options.dataPath + `/${location.pathname.split('/').pop()}`;
			if (_isDevelopment) {
				let html = await fetch(options.dataPath).then((response) => response.text());
				const parser = new DOMParser();
				const doc = parser.parseFromString(html, 'text/html');
				dataDoc = doc;
			}

			loadData();

			if (_isDevelopment) {
				console.log('widgets in this page:', widgets);
			}

			await build_();
		},
	};
}
