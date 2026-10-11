import { Plugin } from 'obsidian';
import { GraphView, GRAPH_VIEW_TYPE } from './GraphView';

export default class Graph3DPlugin extends Plugin {
    async onload() {
        this.registerView(
            GRAPH_VIEW_TYPE,
            (leaf) => new GraphView(leaf)
        );

        this.addCommand({
            id: 'open-3d-graph-view',
            name: 'Open 3D Graph',
            callback: () => {
                this.activateView();
            },
        });

        // Добавляем иконку на левую панель (ленту), чтобы открывать граф в один клик
        this.addRibbonIcon('globe', 'Open 3D Graph', () => {
            this.activateView();
        });
    }

    async onunload() { }

    async activateView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(GRAPH_VIEW_TYPE)[0];

        if (!leaf) {
            // Открываем как центральную вкладку (как обычный документ или граф)
            leaf = workspace.getLeaf(false);
            await leaf.setViewState({ type: GRAPH_VIEW_TYPE, active: true });
        }

        workspace.revealLeaf(leaf);
    }
}