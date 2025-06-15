// @ts-check

// version: 3.5
function appBuilder(options) {
	// # vars
	let $ = document.querySelector.bind(document);
	let devTemplate = null;
	let templateUrl = options?.templateUrl ?? `/template.html`;
	let widgets = [];
	let viewData = options?.viewData ?? {};
	let templates = options?.templates ?? {};
	let dataDoc = document;
	let dataMap = [];
	let countMap = 0;
	let downloadableTemplate = null;

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
		let type = branchNode.dataset.type;

		if (key.endsWith('[]')) {
			let items = [];

			for (let twigNode of branchNode.querySelectorAll('& > div')) {
				readChildArray(twigNode, items);
			}

			data[key.replace('[]', '')] = items;
		} else if (type == 'boolean') {
			try {
				dataMap[countMap++] = JSON.parse(branchNode.textContent);
				data[key] = countMap - 1;
			} catch (error) {
				console.error(error);
			}
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
			removeConditionalWidgets(itemEl, viewData);
			removeConditionalWidgets(itemEl, item);

			Object.entries(item).forEach(([key, value]) => {
				if (Array.isArray(value)) {
					itemEl.querySelectorAll(`[data-slot="${key}"]`).forEach((el) => {
						const docFrag = document.createDocumentFragment();
						const templateName = el.dataset.template;

						for (let v of value) {
							const widgetBuilder = Object.create(widgetBase);
							widgetBuilder.data = v;
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
		if (location.port) {
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

			// replace template file
			replaceIncludables(docEl, docEl);

			let content = docEl.content;
			devTemplate = content;

			downloadableTemplate = docEl.innerHTML;

			fillWidgets();
			$('._app').replaceChildren(content);
		} else {
			let content = $('._appTemplate').content.cloneNode(true);

			$('._appTemplate').remove();

			devTemplate = content.querySelector('[data-title="Blog Template"]');

			fillWidgets();
			$('._app').replaceChildren(...devTemplate.childNodes);
		}

		this.isReady = true;
	}

	function replaceIncludables(docEl, parentNode) {
		for (let el of parentNode.content.querySelectorAll('include')) {
			let target = el.getAttribute('name');
			let templateEl = docEl.content.querySelector(`template[data-includable="${target}"]`)
			console.log(templateEl.content)
			replaceIncludables(docEl, templateEl);
			let clone = templateEl.content.cloneNode(true);


			el.parentNode.insertBefore(clone, el);
			el.remove();
			templateEl.remove();
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
			let dataTagValue;

			if (key.startsWith('!')) {
				isInverse = true;
				key = key.slice(1);
			}

			const evalResult = data[key] ?? false;
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

	// # fill
	function fillWidgets() {
		removeObsoletes(devTemplate);
		removeConditionalWidgets(devTemplate, viewData);
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

				widgetBuilder.data = widgetData.data;

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
			widgetBuilder.data = widgetData.data;

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
			if (location.port) {
				let html = await fetch(options.dataPath).then((response) => response.text());
				const parser = new DOMParser();
				const doc = parser.parseFromString(html, 'text/html');
				dataDoc = doc;
			}

			loadData();

			if (location.port) {
				console.log('widgets in this page:', widgets);
			}

			await build_();
		},
	};
}
