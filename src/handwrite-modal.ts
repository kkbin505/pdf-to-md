import { App, Modal, Notice } from 'obsidian';
import PDFToMDPlugin from '../main';

export class HandwriteModal extends Modal {
  private plugin: PDFToMDPlugin;
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private isDrawing = false;
  private lastX = 0;
  private lastY = 0;
  private strokeWidth = 3;
  private strokeColor = '#000000';
  private history: ImageData[] = [];
  private readonly MAX_HISTORY = 20;

  constructor(app: App, plugin: PDFToMDPlugin) {
    super(app);
    this.plugin = plugin;
  }

  onOpen() {
    const { contentEl, modalEl, containerEl } = this;
    contentEl.empty();
    contentEl.addClass('pdf-to-md-handwrite-modal');

    // Stop containerEl flex-centering so modalEl can fill it absolutely
    containerEl.style.display = 'block';

    // Inline styles bypass CSS cascade — guaranteed to win over Obsidian's class rules
    Object.assign(modalEl.style, {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      maxWidth: '100%',
      maxHeight: '100%',
      borderRadius: '0',
      margin: '0',
      transform: 'none',
    });

    const toolbar = contentEl.createDiv('handwrite-toolbar');

    const widthSlider = toolbar.createEl('input', {
      type: 'range',
      attr: { min: '1', max: '20', value: '3', title: 'Pen width' },
    });
    widthSlider.addEventListener('input', () => {
      this.strokeWidth = parseInt(widthSlider.value);
    });

    const colorPicker = toolbar.createEl('input', {
      type: 'color',
      attr: { value: '#000000', title: 'Pen color' },
    });
    colorPicker.addEventListener('input', () => {
      this.strokeColor = colorPicker.value;
    });

    toolbar.createEl('button', { text: 'Undo' })
      .addEventListener('click', () => this.undo());

    toolbar.createEl('button', { text: 'Clear' })
      .addEventListener('click', () => this.clear());

    toolbar.createEl('button', { text: 'Save & Insert', cls: 'mod-cta' })
      .addEventListener('click', () => this.saveAndInsert());

    this.canvas = contentEl.createEl('canvas');
    this.setupCanvas();
    this.setupPointerEvents();
  }

  private setupCanvas() {
    requestAnimationFrame(() => {
      const dpr = window.devicePixelRatio || 1;
      const toolbarEl = this.contentEl.querySelector<HTMLElement>('.handwrite-toolbar');
      const toolbarH = toolbarEl ? toolbarEl.offsetHeight : 0;
      // Use window dimensions directly — reliable regardless of CSS flex propagation
      const width = window.innerWidth;
      const height = window.innerHeight - toolbarH;

      this.canvas.width = Math.floor(width * dpr);
      this.canvas.height = Math.floor(height * dpr);
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${height}px`;

      const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('Canvas context unavailable');
      this.ctx = ctx;
      this.ctx.scale(dpr, dpr);
      this.ctx.fillStyle = '#ffffff';
      this.ctx.fillRect(0, 0, width, height);
      this.ctx.lineCap = 'round';
      this.ctx.lineJoin = 'round';
    });
  }

  private setupPointerEvents() {
    this.canvas.addEventListener('pointerdown', (e) => {
      this.saveHistory();
      this.isDrawing = true;
      const { x, y } = this.getPos(e);
      this.lastX = x;
      this.lastY = y;
      this.canvas.setPointerCapture(e.pointerId);
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.isDrawing) return;
      const { x, y } = this.getPos(e);
      this.ctx.strokeStyle = this.strokeColor;
      this.ctx.lineWidth = this.strokeWidth;
      this.ctx.beginPath();
      this.ctx.moveTo(this.lastX, this.lastY);
      this.ctx.lineTo(x, y);
      this.ctx.stroke();
      this.lastX = x;
      this.lastY = y;
    });

    this.canvas.addEventListener('pointerup', () => {
      this.isDrawing = false;
    });
  }

  private getPos(e: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  private saveHistory() {
    if (this.history.length >= this.MAX_HISTORY) {
      this.history.shift();
    }
    this.history.push(this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height));
  }

  private undo() {
    const last = this.history.pop();
    if (last) this.ctx.putImageData(last, 0, 0);
  }

  private clear() {
    this.saveHistory();
    const dpr = window.devicePixelRatio || 1;
    this.ctx.fillStyle = '#ffffff';
    this.ctx.fillRect(0, 0, this.canvas.width / dpr, this.canvas.height / dpr);
  }

  private async saveAndInsert() {
    const blob = await new Promise<Blob | null>((resolve) =>
      this.canvas.toBlob(resolve, 'image/png')
    );
    if (!blob) {
      new Notice('Failed to export canvas');
      return;
    }

    const ts = new Date().toISOString().replace(/[-:T.Z]/g, '');
    const folder = this.plugin.settings.handwriteFolder || '';
    const baseName = `handwrite_${ts}`;
    let filename = `${baseName}.png`;
    let path = folder ? `${folder}/${filename}` : filename;

    // Append _1, _2... if file already exists (rare with ms timestamp, but defensive)
    let suffix = 1;
    while (this.app.vault.getAbstractFileByPath(path)) {
      filename = `${baseName}_${suffix}.png`;
      path = folder ? `${folder}/${filename}` : filename;
      suffix++;
    }

    const buffer = await blob.arrayBuffer();

    try {
      await this.app.vault.createBinary(path, buffer);
    } catch (e) {
      new Notice(`Failed to save: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    const editor = this.app.workspace.activeEditor?.editor;
    if (editor) {
      const link = `![](${path})`;
      editor.replaceSelection(link + '\n');
      new Notice(`✓ Saved and inserted ${filename}`);
    } else {
      new Notice(`✓ Saved ${filename} (no active editor)`);
    }

    this.close();
  }

  onClose() {
    this.containerEl.style.removeProperty('display');
    ['position', 'top', 'left', 'width', 'height', 'max-width', 'max-height', 'border-radius', 'margin', 'transform']
      .forEach(p => this.modalEl.style.removeProperty(p));
    this.contentEl.empty();
  }
}
