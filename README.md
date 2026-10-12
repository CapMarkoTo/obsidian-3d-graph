# obsidian-3d-graph

> An interactive, high-performance 3D vault visualization plugin for Obsidian, powered by Three.js and custom Force-Directed physics.

[English](#english) | [Русский](#русский)

---

<a name="english"></a>
## 🚀 Features

- **3D Force-Directed Simulation**: Smooth physics engine supporting node repulsion, spring stiffness, gravity, and damping.
- **Interactive Navigation**: 
  - Drag and drop any node freely (camera controls lock automatically during drag).
  - Pin/Unpin nodes using `Shift + Click`.
  - Open underlying notes instantly via **Double Click**.
- **Adaptive UI Overlay**: A clean top-right collapsible overlay to tune physics parameters in real-time (`Repulsion`, `Spring Length`, `Spring Stiffness`, `Damping`).
- **Performance Control**: Quick toggle to **Freeze/Resume Physics** to save CPU resources when the layout stabilizes.
- **Real-time Vault Sync**: Automatically responds to file creation, deletion, and link changes (`metadataCache`).
- **Theme Adaptive**: Automatically matches Obsidian's Light and Dark themes.

### 📦 Manual Installation
1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Create a folder named `obsidian-3d-graph` inside your vault's plugins directory: `.obsidian/plugins/`.
3. Move the downloaded files into that folder.
4. Reload Obsidian and enable the plugin in settings.

---

<a name="русский"></a>
## 🚀 Возможности

- **3D-физика**: Плавная симуляция на основе сил (отталкивание нод, натяжение пружин, гравитация и затухание).
- **Интерактивность**: 
  - Свободное перетаскивание узлов мышкой (вращение камеры временно блокируется при перетаскивании).
  - Закрепление (pinning) нод с помощью `Shift + Клик`.
  - Быстрое открытие заметок по **Двойному клику**.
- **Удобный оверлей**: Аккуратная сворачиваемая панель в правом верхнем углу для настройки параметров физики на лету.
- **Оптимизация**: Кнопка **Freeze/Resume Physics** для заморозки симуляции и экономии ресурсов процессора, когда граф устаканился.
- **Синхронизация в реальном времени**: Мгновенно отражает создание, удаление файлов и изменение ссылок в хранилище.
- **Адаптивность**: Автоматически подстраивается под светлую и темную темы Obsidian.

### 📦 Ручная установка
1. Скачайте файлы `main.js`, `manifest.json` из раздела релизов.
2. Создайте папку `obsidian-3d-graph` в директории плагинов вашего хранилища: `.obsidian/plugins/`.
3. Поместите скачанные файлы в эту папку.
4. Перезапустите Obsidian и включите плагин в настройках.

---
## 📄 License
MIT License