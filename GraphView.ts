import { ItemView, WorkspaceLeaf, TFile } from 'obsidian';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export const GRAPH_VIEW_TYPE = '3d-graph-view';

interface NodeData {
    id: string;
    title: string;
    file: TFile;
    position: THREE.Vector3;
    mesh?: THREE.Mesh;
}

interface LinkData {
    source: string;
    target: string;
    line?: THREE.Line;
}

export class GraphView extends ItemView {
    private renderer!: THREE.WebGLRenderer;
    private scene!: THREE.Scene;
    private camera!: THREE.PerspectiveCamera;
    private controls!: OrbitControls;
    private animationFrameId!: number;
    private container!: HTMLElement;
    private resizeObserver!: ResizeObserver;

    private nodes: Map<string, NodeData> = new Map();
    private links: LinkData[] = [];
    private graphGroup: THREE.Group = new THREE.Group();

    // Структуры для оптимизации подсветки
    private nodeMeshToId: Map<THREE.Object3D, string> = new Map();
    private adjacencyMap: Map<string, Set<string>> = new Map();

    // Интерактив
    private raycaster: THREE.Raycaster = new THREE.Raycaster();
    private mouse: THREE.Vector2 = new THREE.Vector2();
    private hoveredNodeId: string | null = null;
    private tooltipEl: HTMLElement | null = null;

    // Материалы
    private defaultNodeMat!: THREE.MeshStandardMaterial;
    private defaultLinkMat!: THREE.LineBasicMaterial;
    private highlightNodeMat!: THREE.MeshStandardMaterial;
    private highlightLinkMat!: THREE.LineBasicMaterial;
    private dimmedNodeMat!: THREE.MeshStandardMaterial;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType(): string {
        return GRAPH_VIEW_TYPE;
    }

    getDisplayText(): string {
        return '3D Graph Reborn';
    }

    async onOpen() {
        this.container = this.contentEl;
        this.container.empty();
        this.container.style.position = 'relative';
        this.container.style.width = '100%';
        this.container.style.height = '100%';
        this.container.style.overflow = 'hidden';

        const width = this.container.clientWidth || 400;
        const height = this.container.clientHeight || 400;

        // Определяем тему Obsidian
        const isDarkMode = document.body.classList.contains('theme-dark');

        // 1. Сцена и камера (нейтральный темный / светлый фон)
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(isDarkMode ? 0x161616 : 0xf4f4f4);

        this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
        this.camera.position.set(0, 0, 50);

        // 2. Рендерер
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        this.renderer.domElement.style.width = '100%';
        this.renderer.domElement.style.height = '100%';
        this.renderer.domElement.style.display = 'block';
        this.container.appendChild(this.renderer.domElement);

        // 3. Управление камерой
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.1;

        // 4. Освещение
        const light = new THREE.DirectionalLight(0xffffff, 2);
        light.position.set(10, 10, 10);
        this.scene.add(light);
        this.scene.add(new THREE.AmbientLight(0x404040));

        this.scene.add(this.graphGroup);

        // 5. Инициализация материалов
        this.initMaterials();

        // 6. Подготовка тултипа для названий
        this.initTooltip();

        // 7. Загрузка данных
        this.loadVaultData();

        // 8. Обработка событий мыши
        this.renderer.domElement.addEventListener('mousemove', this.onMouseMove);

        // 9. Цикл анимации
        const animate = () => {
            this.animationFrameId = requestAnimationFrame(animate);
            this.controls.update();
            this.handleHover(); // Проверка наведения каждый кадр
            this.updateTooltipPosition();
            this.renderer.render(this.scene, this.camera);

        // Регистрация слушателей событий хранилища Obsidian
        this.registerEvent(this.app.vault.on('create', (file) => {
            if (file instanceof TFile && file.extension === 'md') {
                this.addNode(file);
            }
        }));

        this.registerEvent(this.app.vault.on('delete', (file) => {
            if (file instanceof TFile) {
                this.removeNode(file.path);
            }
        }));

        this.registerEvent(this.app.metadataCache.on('resolved', () => {
            this.updateLinks();
        }));

        };
        animate();

        // 10. Наблюдатель за размером
        this.resizeObserver = new ResizeObserver((entries) => {
            for (let entry of entries) {
                const { width, height } = entry.contentRect;
                this.onContainerResize(width, height);
            }
        });
        this.resizeObserver.observe(this.container);
    }

    private initMaterials() {
        // Нейтральный серый цвет для узлов (как в стандартном графе Obsidian)
        const nodeColor = 0x888888;

        // Обычные
        this.defaultNodeMat = new THREE.MeshStandardMaterial({ color: nodeColor, roughness: 0.5, metalness: 0.2 });
        this.defaultLinkMat = new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.15 });

        // Подсвеченные (при наведении)
        this.highlightNodeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.8, emissive: 0xffffff, emissiveIntensity: 0.3 });
        this.highlightLinkMat = new THREE.LineBasicMaterial({ color: 0xbbbbbb, transparent: true, opacity: 0.7 });

        // Затемненные (для остальных узлов)
        this.dimmedNodeMat = this.defaultNodeMat.clone();
        this.dimmedNodeMat.transparent = true;
        this.dimmedNodeMat.opacity = 0.15;
    }

    private initTooltip() {
        this.tooltipEl = this.container.createEl('div');
        this.tooltipEl.style.position = 'absolute';
        this.tooltipEl.style.padding = '4px 8px';

        // Используем стандартные переменные Obsidian для фона и текста
        this.tooltipEl.style.background = 'var(--background-secondary)';
        this.tooltipEl.style.color = 'var(--text-normal)';
        this.tooltipEl.style.border = '1px solid var(--background-modifier-border)';

        this.tooltipEl.style.borderRadius = '4px';
        this.tooltipEl.style.fontSize = '12px';
        this.tooltipEl.style.pointerEvents = 'none';
        this.tooltipEl.style.display = 'none';
        this.tooltipEl.style.zIndex = '100';
    }

    private loadVaultData() {
        const files = this.app.vault.getMarkdownFiles();
        const resolvedLinks = this.app.metadataCache.resolvedLinks;

        this.nodes.clear();
        this.links = [];
        this.graphGroup.clear();
        this.nodeMeshToId.clear();
        this.adjacencyMap.clear();

        // Построение нод
        files.forEach((file) => {
            const id = file.path;

            const position = new THREE.Vector3(
                (Math.random() - 0.5) * 40,
                (Math.random() - 0.5) * 40,
                (Math.random() - 0.5) * 40
            );

            const nodeData: NodeData = { id, title: file.basename, file, position };
            this.nodes.set(id, nodeData);
            this.adjacencyMap.set(id, new Set()); // Инициализация карты смежности

            const geometry = new THREE.SphereGeometry(1.2, 16, 16);
            const sphere = new THREE.Mesh(geometry, this.defaultNodeMat);
            sphere.position.copy(position);

            nodeData.mesh = sphere;
            this.graphGroup.add(sphere);

            // Сохраняем связь Меш -> ID для рейкастера
            this.nodeMeshToId.set(sphere, id);
        });

        // Сбор связей и построение карты смежности
        if (resolvedLinks) {
            for (const sourcePath in resolvedLinks) {
                const targets = resolvedLinks[sourcePath];
                for (const targetPath in targets) {
                    if (this.nodes.has(sourcePath) && this.nodes.has(targetPath)) {
                        this.links.push({ source: sourcePath, target: targetPath });
                        // Обновляем карту смежности в обе стороны
                        this.adjacencyMap.get(sourcePath)?.add(targetPath);
                        this.adjacencyMap.get(targetPath)?.add(sourcePath);
                    }
                }
            }
        }

        // Отрисовка линий связей
        this.links.forEach(link => {
            const sourceNode = this.nodes.get(link.source);
            const targetNode = this.nodes.get(link.target);

            if (sourceNode && targetNode) {
                const points = [sourceNode.position, targetNode.position];
                const geometry = new THREE.BufferGeometry().setFromPoints(points);
                const line = new THREE.Line(geometry, this.defaultLinkMat);

                link.line = line; // Сохраняем ссылку на меш линии
                this.graphGroup.add(line);
            }
        });

        console.log(`[3D Graph] Нод: ${this.nodes.size}, Связей: ${this.links.length}`);
    }

    // Обработчик движения мыши
    private onMouseMove = (event: MouseEvent) => {
        // Вычисляем позицию мыши в нормализованных координатах (-1 до +1) для рейкастера
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    };

    // Логика подсветки при наведении
    private handleHover() {
        this.raycaster.setFromCamera(this.mouse, this.camera);
        // Проверяем пересечения только со сферами-нодами
        const intersects = this.raycaster.intersectObjects(Array.from(this.nodeMeshToId.keys()));

        if (intersects.length > 0) {
            const foundMesh = intersects[0].object;
            const nodeId = this.nodeMeshToId.get(foundMesh);

            if (nodeId && nodeId !== this.hoveredNodeId) {
                this.hoveredNodeId = nodeId;
                this.applyHighlight(nodeId);
            }
        } else {
            if (this.hoveredNodeId !== null) {
                this.hoveredNodeId = null;
                this.resetHighlight();
            }
        }
    }

    // Применение подсветки к узлу и соседям
    private applyHighlight(rootId: string) {
        const neighbors = this.adjacencyMap.get(rootId) || new Set();

        // 1. Управление тултипом
        if (this.tooltipEl) {
            const rootNode = this.nodes.get(rootId);
            this.tooltipEl.textContent = rootNode?.title || '';
            this.tooltipEl.style.display = 'block';
        }

        // 2. Подсветка узлов
        this.nodes.forEach((nodeData, id) => {
            if (!nodeData.mesh) return;

            if (id === rootId) {
                nodeData.mesh.material = this.highlightNodeMat; // Сам узел
            } else if (neighbors.has(id)) {
                nodeData.mesh.material = this.defaultNodeMat; // Соседи (обычный цвет)
            } else {
                nodeData.mesh.material = this.dimmedNodeMat; // Остальные (затемнить)
            }
        });

        // 3. Подсветка линий
        this.links.forEach(link => {
            if (!link.line) return;
            // Линия подсвечивается, если один из ее концов — наведенный узел
            if (link.source === rootId || link.target === rootId) {
                link.line.material = this.highlightLinkMat;
            } else {
                link.line.material = this.defaultLinkMat;
            }
        });
    }

    // Сброс подсветки к обычному состоянию
    private resetHighlight() {
        if (this.tooltipEl) {
            this.tooltipEl.style.display = 'none';
        }

        this.nodes.forEach(nodeData => {
            if (nodeData.mesh) nodeData.mesh.material = this.defaultNodeMat;
        });

        this.links.forEach(link => {
            if (link.line) link.line.material = this.defaultLinkMat;
        });
    }

    // Обновление позиции тултипа на экране
    private updateTooltipPosition() {
        if (!this.hoveredNodeId || !this.tooltipEl) return;
        const rootNode = this.nodes.get(this.hoveredNodeId);
        if (!rootNode || !rootNode.mesh) return;

        // Проецируем 3D позицию узла на 2D экран
        const pos = rootNode.position.clone();
        pos.project(this.camera);

        const rect = this.renderer.domElement.getBoundingClientRect();
        const x = (pos.x + 1) * rect.width / 2 + rect.left;
        const y = (-pos.y + 1) * rect.height / 2 + rect.top;

        // Позиционируем HTML элемент (чуть выше и правее узла)
        this.tooltipEl.style.left = `${x - rect.left + 15}px`;
        this.tooltipEl.style.top = `${y - rect.top - 15}px`;
    }

    async onClose() {
        this.renderer.domElement.removeEventListener('mousemove', this.onMouseMove);
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        if (this.controls) {
            this.controls.dispose();
        }
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.domElement.remove();
        }
    }
    private addNode(file: TFile) {
        const id = file.path;
        if (this.nodes.has(id)) return;

        // Рандомная позиция для новой ноды неподалеку от центра
        const position = new THREE.Vector3(
            (Math.random() - 0.5) * 30,
            (Math.random() - 0.5) * 30,
            (Math.random() - 0.5) * 30
        );

        const nodeData: NodeData = { id, title: file.basename, file, position };
        this.nodes.set(id, nodeData);
        this.adjacencyMap.set(id, new Set());

        const geometry = new THREE.SphereGeometry(1.2, 16, 16);
        const sphere = new THREE.Mesh(geometry, this.defaultNodeMat);
        sphere.position.copy(position);

        nodeData.mesh = sphere;
        this.graphGroup.add(sphere);
        this.nodeMeshToId.set(sphere, id);

        console.log(`[3D Graph] Добавлена новая нода: ${file.basename}`);
    }

    private removeNode(id: string) {
        const nodeData = this.nodes.get(id);
        if (!nodeData) return;

        if (nodeData.mesh) {
            this.graphGroup.remove(nodeData.mesh);
            this.nodeMeshToId.delete(nodeData.mesh);
            nodeData.mesh.geometry.dispose();
        }

        this.nodes.delete(id);
        this.adjacencyMap.delete(id);

        // Удаляем связанные линии
        this.links = this.links.filter(link => {
            if (link.source === id || link.target === id) {
                if (link.line) {
                    this.graphGroup.remove(link.line);
                    link.line.geometry.dispose();
                }
                return false;
            }
            return true;
        });

        console.log(`[3D Graph] Удалена нода: ${id}`);
    }

    private updateLinks() {
        const resolvedLinks = this.app.metadataCache.resolvedLinks;
        if (!resolvedLinks) return;

        // Очищаем старые линии
        this.links.forEach(link => {
            if (link.line) {
                this.graphGroup.remove(link.line);
                link.line.geometry.dispose();
            }
        });
        this.links = [];
        this.adjacencyMap.forEach(set => set.clear());

        // Пересобираем связи
        for (const sourcePath in resolvedLinks) {
            const targets = resolvedLinks[sourcePath];
            for (const targetPath in targets) {
                if (this.nodes.has(sourcePath) && this.nodes.has(targetPath)) {
                    this.links.push({ source: sourcePath, target: targetPath });
                    this.adjacencyMap.get(sourcePath)?.add(targetPath);
                    this.adjacencyMap.get(targetPath)?.add(sourcePath);
                }
            }
        }

        // Отрисовываем линии заново
        this.links.forEach(link => {
            const sourceNode = this.nodes.get(link.source);
            const targetNode = this.nodes.get(link.target);

            if (sourceNode && targetNode) {
                const points = [sourceNode.position, targetNode.position];
                const geometry = new THREE.BufferGeometry().setFromPoints(points);
                const line = new THREE.Line(geometry, this.defaultLinkMat);

                link.line = line;
                this.graphGroup.add(line);
            }
        });
    }

    private onContainerResize = (width: number, height: number) => {
        if (!this.renderer || !this.camera || width === 0 || height === 0) return;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
}