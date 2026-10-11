import { ItemView, WorkspaceLeaf, TFile } from 'obsidian';
import * as THREE from 'three';

export const GRAPH_VIEW_TYPE = '3d-graph-view';

interface NodeData {
    id: string;
    title: string;
    file: TFile;
    mesh?: THREE.Mesh;
}

interface LinkData {
    source: string;
    target: string;
}

export class GraphView extends ItemView {
    private renderer!: THREE.WebGLRenderer;
    private scene!: THREE.Scene;
    private camera!: THREE.PerspectiveCamera;
    private animationFrameId!: number;
    private container!: HTMLElement;
    private resizeObserver!: ResizeObserver;

    private nodes: Map<string, NodeData> = new Map();
    private links: LinkData[] = [];
    private nodeMeshesGroup: THREE.Group = new THREE.Group();

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

        // 1. Инициализация сцены и камеры
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x1e1e2e);

        this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
        this.camera.position.z = 50;

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        this.renderer.domElement.style.width = '100%';
        this.renderer.domElement.style.height = '100%';
        this.renderer.domElement.style.display = 'block';

        this.container.appendChild(this.renderer.domElement);

        // Освещение
        const light = new THREE.DirectionalLight(0xffffff, 2);
        light.position.set(10, 10, 10);
        this.scene.add(light);
        this.scene.add(new THREE.AmbientLight(0x404040));

        this.scene.add(this.nodeMeshesGroup);

        // 2. Загружаем данные из хранилища Obsidian и строим ноды
        this.loadVaultData();

        // 3. Анимация
        const animate = () => {
            this.animationFrameId = requestAnimationFrame(animate);
            this.nodeMeshesGroup.rotation.y += 0.002; // Медленное вращение всего графа для теста
            this.renderer.render(this.scene, this.camera);
        };
        animate();

        // 4. Наблюдатель за размером
        this.resizeObserver = new ResizeObserver((entries) => {
            for (let entry of entries) {
                const { width, height } = entry.contentRect;
                this.onContainerResize(width, height);
            }
        });
        this.resizeObserver.observe(this.container);
    }

    private loadVaultData() {
        const files = this.app.vault.getMarkdownFiles();
        const resolvedLinks = this.app.metadataCache.resolvedLinks;

        // Создаем сферы для каждой заметки
        files.forEach((file, index) => {
            const id = file.path;
            this.nodes.set(id, { id, title: file.basename, file });

            // Случайное распределение нод в пространстве для начала
            const x = (Math.random() - 0.5) * 40;
            const y = (Math.random() - 0.5) * 40;
            const z = (Math.random() - 0.5) * 40;

            const geometry = new THREE.SphereGeometry(1.2, 16, 16);
            const material = new THREE.MeshStandardMaterial({
                color: 0x7a5cff,
                roughness: 0.3,
                metalness: 0.8
            });
            const sphere = new THREE.Mesh(geometry, material);
            sphere.position.set(x, y, z);

            this.nodeMeshesGroup.add(sphere);
        });

        // Сбор связей
        if (resolvedLinks) {
            for (const sourcePath in resolvedLinks) {
                const targets = resolvedLinks[sourcePath];
                for (const targetPath in targets) {
                    this.links.push({ source: sourcePath, target: targetPath });
                }
            }
        }

        console.log(`[3D Graph] Загружено заметок: ${this.nodes.size}, связей: ${this.links.length}`);
    }

    async onClose() {
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        if (this.renderer) {
            this.renderer.dispose();
            this.renderer.domElement.remove();
        }
    }

    private onContainerResize = (width: number, height: number) => {
        if (!this.renderer || !this.camera || width === 0 || height === 0) return;
        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(width, height);
    }
}