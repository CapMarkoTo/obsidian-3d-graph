import { ItemView, WorkspaceLeaf, TFile } from 'obsidian';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export const GRAPH_VIEW_TYPE = '3d-graph-view';

interface NodeData {
    id: string;
    title: string;
    file: TFile;
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    pinned?: boolean;
    mesh?: THREE.Mesh;
}

interface LinkData {
    source: string;
    target: string;
    line?: THREE.Line;
}

interface GraphSettings {
    repulsionStrength: number;
    springLength: number;
    springStiffness: number;
    damping: number;
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

    private nodeMeshToId: Map<THREE.Object3D, string> = new Map();
    private adjacencyMap: Map<string, Set<string>> = new Map();

    private raycaster: THREE.Raycaster = new THREE.Raycaster();
    private mouse: THREE.Vector2 = new THREE.Vector2();
    private hoveredNodeId: string | null = null;
    private tooltipEl: HTMLElement | null = null;
    private overlayEl: HTMLElement | null = null;

    // Перетаскивание
    private draggedNodeId: string | null = null;
    private dragPlane: THREE.Plane = new THREE.Plane();

    // Состояние симуляции
    private isPhysicsActive: boolean = true;

    // Настройки физики
    private settings: GraphSettings = {
        repulsionStrength: 15.0,
        springLength: 12.0,
        springStiffness: 0.05,
        damping: 0.85
    };

    private defaultNodeMat!: THREE.MeshStandardMaterial;
    private pinnedNodeMat!: THREE.MeshStandardMaterial;
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

        const isDarkMode = document.body.classList.contains('theme-dark');

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(isDarkMode ? 0x161616 : 0xf4f4f4);

        this.camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
        this.camera.position.set(0, 0, 50);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

        this.renderer.domElement.style.width = '100%';
        this.renderer.domElement.style.height = '100%';
        this.renderer.domElement.style.display = 'block';
        this.container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.1;

        const light = new THREE.DirectionalLight(0xffffff, 2);
        light.position.set(10, 10, 10);
        this.scene.add(light);
        this.scene.add(new THREE.AmbientLight(0x404040));

        this.scene.add(this.graphGroup);

        this.initMaterials();
        this.initTooltip();
        this.initOverlay();
        this.loadVaultData();

        this.renderer.domElement.addEventListener('mousemove', this.onMouseMove);
        this.renderer.domElement.addEventListener('mousedown', this.onMouseDown);
        this.renderer.domElement.addEventListener('dblclick', this.onDblClick);
        window.addEventListener('mouseup', this.onMouseUp);

        const animate = () => {
            this.animationFrameId = requestAnimationFrame(animate);

            if (this.isPhysicsActive) {
                this.updatePhysics();
            }
            this.updateLines();

            this.controls.update();
            this.handleHover();
            this.updateTooltipPosition();

            this.renderer.render(this.scene, this.camera);
        };
        animate();

        this.resizeObserver = new ResizeObserver((entries) => {
            for (let entry of entries) {
                const { width, height } = entry.contentRect;
                this.onContainerResize(width, height);
            }
        });
        this.resizeObserver.observe(this.container);

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
    }

    private initMaterials() {
        const nodeColor = 0x888888;

        this.defaultNodeMat = new THREE.MeshStandardMaterial({ color: nodeColor, roughness: 0.5, metalness: 0.2 });
        this.pinnedNodeMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.3, metalness: 0.5, emissive: 0x444444 });
        this.defaultLinkMat = new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.15 });

        this.highlightNodeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.1, metalness: 0.8, emissive: 0xffffff, emissiveIntensity: 0.3 });
        this.highlightLinkMat = new THREE.LineBasicMaterial({ color: 0xbbbbbb, transparent: true, opacity: 0.7 });

        this.dimmedNodeMat = this.defaultNodeMat.clone();
        this.dimmedNodeMat.transparent = true;
        this.dimmedNodeMat.opacity = 0.15;
    }

    private initTooltip() {
        this.tooltipEl = this.container.createEl('div');
        this.tooltipEl.style.position = 'absolute';
        this.tooltipEl.style.padding = '4px 8px';
        this.tooltipEl.style.background = 'var(--background-secondary)';
        this.tooltipEl.style.color = 'var(--text-normal)';
        this.tooltipEl.style.border = '1px solid var(--background-modifier-border)';
        this.tooltipEl.style.borderRadius = '4px';
        this.tooltipEl.style.fontSize = '12px';
        this.tooltipEl.style.pointerEvents = 'none';
        this.tooltipEl.style.display = 'none';
        this.tooltipEl.style.zIndex = '100';
    }

    private initOverlay() {
        this.overlayEl = this.container.createEl('div');
        this.overlayEl.className = 'graph-overlay';
        Object.assign(this.overlayEl.style, {
            position: 'absolute',
            top: '12px',
            right: '12px',
            width: '240px',
            padding: '12px',
            background: 'var(--background-secondary)',
            color: 'var(--text-normal)',
            border: '1px solid var(--background-modifier-border)',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
            fontSize: '12px',
            zIndex: '50',
            backdropFilter: 'blur(8px)'
        });

        const header = this.overlayEl.createDiv();
        Object.assign(header.style, {
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontWeight: '600',
            cursor: 'pointer',
            userSelect: 'none'
        });

        const titleSpan = header.createSpan();
        titleSpan.setText('⚙️ Graph Physics');

        const toggleBtn = header.createSpan();
        toggleBtn.setText('▼');
        toggleBtn.style.fontSize = '10px';

        const content = this.overlayEl.createDiv();
        content.style.marginTop = '10px';

        let isCollapsed = false;
        header.addEventListener('click', () => {
            isCollapsed = !isCollapsed;
            content.style.display = isCollapsed ? 'none' : 'block';
            toggleBtn.setText(isCollapsed ? '▲' : '▼');
        });

        const addSlider = (label: string, min: number, max: number, step: number, value: number, onChange: (val: number) => void) => {
            const wrapper = content.createDiv();
            wrapper.style.marginBottom = '8px';

            const title = wrapper.createDiv();
            title.setText(label);
            title.style.marginBottom = '2px';

            const input = wrapper.createEl('input', { type: 'range' });
            Object.assign(input, { min, max, step, value });
            input.style.width = '100%';

            input.addEventListener('input', (e) => {
                onChange(parseFloat((e.target as HTMLInputElement).value));
            });
        };

        addSlider('Repulsion', 1, 50, 1, this.settings.repulsionStrength, (val) => { this.settings.repulsionStrength = val; });
        addSlider('Spring Length', 2, 30, 1, this.settings.springLength, (val) => { this.settings.springLength = val; });
        addSlider('Spring Stiffness', 0.01, 0.2, 0.01, this.settings.springStiffness, (val) => { this.settings.springStiffness = val; });
        addSlider('Damping', 0.5, 0.98, 0.01, this.settings.damping, (val) => { this.settings.damping = val; });

        const freezeBtn = content.createEl('button', { text: 'Freeze Physics' });
        Object.assign(freezeBtn.style, {
            width: '100%',
            marginTop: '6px',
            padding: '5px',
            background: 'var(--interactive-normal)',
            color: 'var(--text-normal)',
            border: '1px solid var(--background-modifier-border)',
            borderRadius: '4px',
            cursor: 'pointer'
        });

        freezeBtn.addEventListener('click', () => {
            this.isPhysicsActive = !this.isPhysicsActive;
            freezeBtn.setText(this.isPhysicsActive ? 'Freeze Physics' : 'Resume Physics');
            freezeBtn.style.background = this.isPhysicsActive ? 'var(--interactive-normal)' : 'var(--interactive-accent)';
            freezeBtn.style.color = this.isPhysicsActive ? 'var(--text-normal)' : 'var(--text-on-accent)';
        });

        const resetBtn = content.createEl('button', { text: 'Reset Layout' });
        Object.assign(resetBtn.style, {
            width: '100%',
            marginTop: '4px',
            padding: '5px',
            background: 'var(--interactive-accent)',
            color: 'var(--text-on-accent)',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
        });
        resetBtn.addEventListener('click', () => {
            this.isPhysicsActive = true;
            freezeBtn.setText('Freeze Physics');
            freezeBtn.style.background = 'var(--interactive-normal)';
            freezeBtn.style.color = 'var(--text-normal)';
            this.loadVaultData();
        });
    }

    private loadVaultData() {
        const files = this.app.vault.getMarkdownFiles();
        const resolvedLinks = this.app.metadataCache.resolvedLinks;

        this.nodes.clear();
        this.links = [];
        this.graphGroup.clear();
        this.nodeMeshToId.clear();
        this.adjacencyMap.clear();

        files.forEach((file) => {
            const id = file.path;

            const position = new THREE.Vector3(
                (Math.random() - 0.5) * 30,
                (Math.random() - 0.5) * 30,
                (Math.random() - 0.5) * 30
            );

            const nodeData: NodeData = {
                id,
                title: file.basename,
                file,
                position,
                velocity: new THREE.Vector3(0, 0, 0),
                pinned: false
            };
            this.nodes.set(id, nodeData);
            this.adjacencyMap.set(id, new Set());

            const geometry = new THREE.SphereGeometry(1.2, 16, 16);
            const sphere = new THREE.Mesh(geometry, this.defaultNodeMat);
            sphere.position.copy(position);

            nodeData.mesh = sphere;
            this.graphGroup.add(sphere);
            this.nodeMeshToId.set(sphere, id);
        });

        if (resolvedLinks) {
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
        }

        this.createLinkMeshes();
    }

    private createLinkMeshes() {
        const lineMaterial = this.defaultLinkMat;
        this.links.forEach(link => {
            const sourceNode = this.nodes.get(link.source);
            const targetNode = this.nodes.get(link.target);

            if (sourceNode && targetNode) {
                const points = [sourceNode.position, targetNode.position];
                const geometry = new THREE.BufferGeometry().setFromPoints(points);
                const line = new THREE.Line(geometry, lineMaterial);
                link.line = line;
                this.graphGroup.add(line);
            }
        });
    }

    private updatePhysics() {
        const nodesArr = Array.from(this.nodes.values());

        for (let i = 0; i < nodesArr.length; i++) {
            for (let j = i + 1; j < nodesArr.length; j++) {
                const n1 = nodesArr[i];
                const n2 = nodesArr[j];

                const dir = new THREE.Vector3().subVectors(n1.position, n2.position);
                let dist = dir.length();
                if (dist === 0) dist = 0.1;

                const force = (this.settings.repulsionStrength / (dist * dist));
                dir.normalize().multiplyScalar(force);

                if (!n1.pinned && n1.id !== this.draggedNodeId) n1.velocity.add(dir);
                if (!n2.pinned && n2.id !== this.draggedNodeId) n2.velocity.sub(dir);
            }
        }

        this.links.forEach(link => {
            const n1 = this.nodes.get(link.source);
            const n2 = this.nodes.get(link.target);

            if (!n1 || !n2) return;

            const dir = new THREE.Vector3().subVectors(n2.position, n1.position);
            const dist = dir.length();

            const displacement = dist - this.settings.springLength;
            dir.normalize().multiplyScalar(displacement * this.settings.springStiffness);

            if (!n1.pinned && n1.id !== this.draggedNodeId) n1.velocity.add(dir);
            if (!n2.pinned && n2.id !== this.draggedNodeId) n2.velocity.sub(dir);
        });

        nodesArr.forEach(node => {
            if (node.id === this.draggedNodeId) {
                node.velocity.set(0, 0, 0);
                return;
            }

            if (node.pinned) {
                node.velocity.set(0, 0, 0);
                if (node.mesh) node.mesh.position.copy(node.position);
                return;
            }

            const centerDir = node.position.clone().negate().multiplyScalar(0.01);
            node.velocity.add(centerDir);

            node.velocity.multiplyScalar(this.settings.damping);
            node.position.add(node.velocity);

            if (node.mesh) {
                node.mesh.position.copy(node.position);
            }
        });
    }

    private updateLines() {
        this.links.forEach(link => {
            if (!link.line) return;
            const n1 = this.nodes.get(link.source);
            const n2 = this.nodes.get(link.target);

            if (n1 && n2) {
                const positions = link.line.geometry.attributes.position as THREE.BufferAttribute;
                positions.setXYZ(0, n1.position.x, n1.position.y, n1.position.z);
                positions.setXYZ(1, n2.position.x, n2.position.y, n2.position.z);
                positions.needsUpdate = true;
            }
        });
    }

    private onMouseMove = (event: MouseEvent) => {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        if (this.draggedNodeId) {
            this.raycaster.setFromCamera(this.mouse, this.camera);
            const targetPos = new THREE.Vector3();
            this.raycaster.ray.intersectPlane(this.dragPlane, targetPos);

            const node = this.nodes.get(this.draggedNodeId);
            if (node) {
                node.position.copy(targetPos);
                if (node.mesh) node.mesh.position.copy(targetPos);
            }
        }
    };

    private onMouseDown = (event: MouseEvent) => {
        if (event.button !== 0) return;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(Array.from(this.nodeMeshToId.keys()));

        if (intersects.length > 0) {
            const foundMesh = intersects[0].object;
            const nodeId = this.nodeMeshToId.get(foundMesh);

            if (nodeId) {
                this.draggedNodeId = nodeId;
                this.controls.enabled = false;

                const node = this.nodes.get(nodeId);
                if (node) {
                    const normal = this.camera.getWorldDirection(new THREE.Vector3()).negate();
                    this.dragPlane.setFromNormalAndCoplanarPoint(normal, node.position);

                    if (event.shiftKey) {
                        node.pinned = !node.pinned;
                        if (node.mesh) {
                            node.mesh.material = node.pinned ? this.pinnedNodeMat : this.defaultNodeMat;
                        }
                    }
                }
            }
        }
    };

    private onMouseUp = () => {
        if (this.draggedNodeId) {
            this.draggedNodeId = null;
            this.controls.enabled = true;
        }
    };

    private onDblClick = (event: MouseEvent) => {
        if (event.button !== 0) return;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(Array.from(this.nodeMeshToId.keys()));

        if (intersects.length > 0) {
            const foundMesh = intersects[0].object;
            const nodeId = this.nodeMeshToId.get(foundMesh);

            if (nodeId) {
                const nodeData = this.nodes.get(nodeId);
                if (nodeData) {
                    const leaf = this.app.workspace.getLeaf(event.ctrlKey || event.metaKey);
                    leaf.openFile(nodeData.file);
                }
            }
        }
    };

    private handleHover() {
        if (this.draggedNodeId) return;

        this.raycaster.setFromCamera(this.mouse, this.camera);
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

    private applyHighlight(rootId: string) {
        const neighbors = this.adjacencyMap.get(rootId) || new Set();

        if (this.tooltipEl) {
            const rootNode = this.nodes.get(rootId);
            this.tooltipEl.textContent = rootNode?.title || '';
            this.tooltipEl.style.display = 'block';
        }

        this.nodes.forEach((nodeData, id) => {
            if (!nodeData.mesh) return;

            if (id === rootId) {
                nodeData.mesh.material = this.highlightNodeMat;
            } else if (neighbors.has(id)) {
                nodeData.mesh.material = nodeData.pinned ? this.pinnedNodeMat : this.defaultNodeMat;
            } else {
                nodeData.mesh.material = this.dimmedNodeMat;
            }
        });

        this.links.forEach(link => {
            if (!link.line) return;
            if (link.source === rootId || link.target === rootId) {
                link.line.material = this.highlightLinkMat;
            } else {
                link.line.material = this.defaultLinkMat;
            }
        });
    }

    private resetHighlight() {
        if (this.tooltipEl) {
            this.tooltipEl.style.display = 'none';
        }

        this.nodes.forEach(nodeData => {
            if (nodeData.mesh) {
                nodeData.mesh.material = nodeData.pinned ? this.pinnedNodeMat : this.defaultNodeMat;
            }
        });

        this.links.forEach(link => {
            if (link.line) link.line.material = this.defaultLinkMat;
        });
    }

    private updateTooltipPosition() {
        if (!this.hoveredNodeId || !this.tooltipEl) return;
        const rootNode = this.nodes.get(this.hoveredNodeId);
        if (!rootNode || !rootNode.mesh) return;

        const pos = rootNode.position.clone();
        pos.project(this.camera);

        const rect = this.renderer.domElement.getBoundingClientRect();
        const x = (pos.x + 1) * rect.width / 2 + rect.left;
        const y = (-pos.y + 1) * rect.height / 2 + rect.top;

        this.tooltipEl.style.left = `${x - rect.left + 15}px`;
        this.tooltipEl.style.top = `${y - rect.top - 15}px`;
    }

    private addNode(file: TFile) {
        const id = file.path;
        if (this.nodes.has(id)) return;

        const position = new THREE.Vector3(
            (Math.random() - 0.5) * 20,
            (Math.random() - 0.5) * 20,
            (Math.random() - 0.5) * 20
        );

        const nodeData: NodeData = {
            id,
            title: file.basename,
            file,
            position,
            velocity: new THREE.Vector3(0, 0, 0),
            pinned: false
        };
        this.nodes.set(id, nodeData);
        this.adjacencyMap.set(id, new Set());

        const geometry = new THREE.SphereGeometry(1.2, 16, 16);
        const sphere = new THREE.Mesh(geometry, this.defaultNodeMat);
        sphere.position.copy(position);

        nodeData.mesh = sphere;
        this.graphGroup.add(sphere);
        this.nodeMeshToId.set(sphere, id);
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
    }

    private updateLinks() {
        const resolvedLinks = this.app.metadataCache.resolvedLinks;
        if (!resolvedLinks) return;

        this.links.forEach(link => {
            if (link.line) {
                this.graphGroup.remove(link.line);
                link.line.geometry.dispose();
            }
        });
        this.links = [];
        this.adjacencyMap.forEach(set => set.clear());

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

        this.createLinkMeshes();
    }

    async onClose() {
        this.renderer.domElement.removeEventListener('mousemove', this.onMouseMove);
        this.renderer.domElement.removeEventListener('mousedown', this.onMouseDown);
        this.renderer.domElement.removeEventListener('dblclick', this.onDblClick);
        window.removeEventListener('mouseup', this.onMouseUp);

        if (this.overlayEl) this.overlayEl.remove();
        if (this.tooltipEl) this.tooltipEl.remove();
        if (this.resizeObserver) this.resizeObserver.disconnect();
        if (this.animationFrameId) cancelAnimationFrame(this.animationFrameId);
        if (this.controls) this.controls.dispose();
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