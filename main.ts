import { Plugin, Notice, TFile, Menu } from 'obsidian';
import * as pdfjsLib from 'pdfjs-dist';
import { PDFToMDSettings, PDFToMDSettingTab, DEFAULT_SETTINGS, MODEL_OPTIONS } from './src/settings';
import { PDFConverter } from './src/converter';
import { ModelProvider } from './src/providers/base';
import { OpenAICompatibleProvider } from './src/providers/openai-compat';
import { AnthropicProvider } from './src/providers/anthropic';
import { HandwriteModal } from './src/handwrite-modal';

export default class PDFToMDPlugin extends Plugin {
  settings: PDFToMDSettings;
  private apiKeys: Map<string, string> = new Map();  // Store API keys in memory

  private setupPdfWorker() {
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://unpkg.com/pdfjs-dist@5.7.284/build/pdf.worker.min.mjs';
  }

  async onload() {
    // Setup PDF.js worker
    this.setupPdfWorker();

    await this.loadSettings();

    // Load API keys from environment variables
    this.loadApiKeysFromEnv();

    this.addSettingTab(new PDFToMDSettingTab(this.app, this));

    // Handwriting canvas: ribbon icon + command
    this.addRibbonIcon('pencil', 'Handwrite note', () => {
      new HandwriteModal(this.app, this).open();
    });

    this.addCommand({
      id: 'open-handwrite-modal',
      name: 'Open handwriting canvas',
      callback: () => {
        new HandwriteModal(this.app, this).open();
      },
    });

    const supportedImageExtensions = ['png', 'jpg', 'jpeg', 'webp'];

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file, source) => {
        if (!(file instanceof TFile)) return;

        if (file.extension === 'pdf') {
          menu.addItem(item =>
            item
              .setTitle('Convert to Markdown')
              .setIcon('file-text')
              .onClick(() => this.convertFile(file))
          );
        } else if (supportedImageExtensions.includes(file.extension.toLowerCase())) {
          // Detect if right-click came from inside an editor (link/embed menu)
          // vs from file explorer
          const fromEditor = source === 'link-context-menu' || source === 'embed-context-menu';

          menu.addItem(item =>
            item
              .setTitle('Convert Image to Markdown')
              .setIcon('image')
              .setSection('pdf-to-md')
              .onClick(() => {
                if (fromEditor) {
                  this.convertImageInNoteFromFile(file);
                } else {
                  this.convertFile(file);
                }
              })
          );
        }
      })
    );
  }

  private loadApiKeysFromEnv() {
    const envVars = {
      'openai': 'OPENAI_API_KEY',
      'qwen': 'DASHSCOPE_API_KEY',
      'gemini': 'GEMINI_API_KEY',
      'claude': 'ANTHROPIC_API_KEY',
    };

    for (const [provider, envVar] of Object.entries(envVars)) {
      const value = this.getEnvValue(envVar);
      if (value) {
        this.apiKeys.set(provider, value);
        console.log(`✓ Loaded ${envVar}`);
      } else {
        console.warn(`⚠️ ${envVar} not found in environment variables`);
      }
    }
  }

  private getEnvValue(envVarName: string): string | null {
    try {
      if (typeof process !== 'undefined' && process.env) {
        return process.env[envVarName] || null;
      }
    } catch (e) {
      // Silently fail
    }
    return null;
  }

  private getApiKey(provider: string): string | null {
    return this.apiKeys.get(provider) || null;
  }

  private async convertFile(file: TFile) {
    try {
      const isPdf = file.extension === 'pdf';
      const isImage = ['png', 'jpg', 'jpeg', 'webp'].includes(file.extension.toLowerCase());

      if (!isPdf && !isImage) {
        new Notice('❌ Unsupported file type. Only PDF, PNG, JPG, JPEG, and WebP are supported.', 5000);
        return;
      }

      // Check if API key is configured
      const apiKey = this.getApiKey(this.settings.provider);
      if (!apiKey) {
        const envVarMap: Record<string, string> = {
          openai: 'OPENAI_API_KEY',
          qwen: 'DASHSCOPE_API_KEY',
          gemini: 'GEMINI_API_KEY',
          claude: 'ANTHROPIC_API_KEY',
        };
        const providerNameMap: Record<string, string> = {
          openai: 'OpenAI',
          qwen: 'Alibaba Qwen',
          gemini: 'Google Gemini',
          claude: 'Anthropic Claude',
        };
        const envVar = envVarMap[this.settings.provider] ?? 'API_KEY';
        const providerName = providerNameMap[this.settings.provider] ?? this.settings.provider;

        new Notice(
          `❌ ${providerName} API Key not configured!\n\nPlease set environment variable: ${envVar}\n\nThen restart Obsidian.`,
          10000
        );
        console.error(`API Key missing. Environment variable: ${envVar}`);
        return;
      }

      const notice = new Notice(`Starting ${isPdf ? 'PDF' : 'Image'} conversion...`, 0);

      const data = await this.app.vault.readBinary(file);

      const provider = this.createProvider(apiKey);
      const converter = new PDFConverter(provider, {
        timeout: this.settings.timeout * 1000,
        maxRetries: this.settings.maxRetries,
      });

      let startTime = Date.now();

      converter.setProgressCallback(progress => {
        const percent = Math.round((progress.current / progress.total) * 100);
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        const bar = this.createProgressBar(percent);

        const message = `${bar} ${progress.status}\n[${progress.current}/${progress.total}] ${elapsed}s`;
        notice.setMessage(message);
      });

      let markdown: string;
      if (isPdf) {
        markdown = await converter.convertPdfBuffer(data, this.settings.dpi);
      } else {
        markdown = await converter.convertImageBuffer(data);
      }

      // Determine output path based on conflict resolution strategy
      const outputPath = this.getOutputPath(file);

      // Check if file exists
      const existingFile = this.app.vault.getAbstractFileByPath(outputPath);

      if (existingFile && this.settings.conflictResolution === 'skip') {
        new Notice(`File already exists: ${outputPath}. Skipped.`, 5000);
        return;
      }

      // Create or overwrite file
      if (existingFile && existingFile instanceof TFile) {
        await this.app.vault.modify(existingFile, markdown);
      } else {
        await this.app.vault.create(outputPath, markdown);
      }

      notice.setMessage(`✓ Converted to ${outputPath}`);
      setTimeout(() => notice.hide(), 3000);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Provide helpful error messages
      if (message.includes('Unauthorized') || message.includes('API key')) {
        new Notice(`❌ API Error: Invalid or expired API key. Please check your environment variables.`, 10000);
      } else if (message.includes('timeout')) {
        new Notice(`❌ Conversion timeout. Try increasing timeout in plugin settings or use a faster model.`, 10000);
      } else {
        new Notice(`Error: ${message}`, 10000);
      }

      console.error('Conversion error:', error);
    }
  }

  private getOutputPath(file: TFile): string {
    const ext = file.extension === 'pdf' ? '.pdf' : `.${file.extension}`;
    const basePath = file.path.replace(ext, '');
    const baseName = basePath.split('/').pop() || 'output';
    const dir = basePath.substring(0, basePath.length - baseName.length);

    switch (this.settings.conflictResolution) {
      case 'by-model': {
        const modelName = this.getModelDisplayName();
        return `${dir}${baseName}_${modelName}.md`;
      }
      case 'timestamp': {
        const now = new Date();
        const timestamp = now.toISOString().replace(/[:.]/g, '').substring(0, 15);
        return `${dir}${baseName}_${timestamp}.md`;
      }
      case 'skip':
      case 'overwrite':
      default:
        return `${dir}${baseName}.md`;
    }
  }

  private getModelDisplayName(): string {
    const settings = this.settings;
    const selectedModel = MODEL_OPTIONS.find(m => m.id === settings.selectedModelId) || MODEL_OPTIONS[0];

    if (selectedModel.provider === 'openai') {
      return selectedModel.apiModel;
    }
    if (selectedModel.provider === 'qwen') {
      return 'qwen';
    }
    return selectedModel.id;
  }

  private createProgressBar(percent: number): string {
    const filled = Math.round((percent / 100) * 20);
    const empty = 20 - filled;
    const bar = '█'.repeat(filled) + '░'.repeat(empty);
    return `[${bar}] ${percent}%`;
  }

  private createProvider(apiKey: string): ModelProvider {
    const settings = this.settings;
    const selectedModel = MODEL_OPTIONS.find(m => m.id === settings.selectedModelId) || MODEL_OPTIONS[0];
    const modelName = selectedModel.apiModel;

    switch (settings.provider) {
      case 'openai':
        return new OpenAICompatibleProvider(
          {
            apiKey: apiKey,
            model: modelName,
          },
          'https://api.openai.com/v1'
        );

      case 'qwen':
        return new OpenAICompatibleProvider(
          {
            apiKey: apiKey,
            model: modelName,
          },
          'https://dashscope.aliyuncs.com/compatible-mode/v1'
        );

      case 'gemini':
        return new OpenAICompatibleProvider(
          {
            apiKey: apiKey,
            model: modelName,
          },
          'https://generativelanguage.googleapis.com/v1beta/openai/'
        );

      case 'claude':
        return new AnthropicProvider({ apiKey: apiKey, model: modelName });

      default:
        throw new Error(`Unknown provider: ${settings.provider}`);
    }
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    
    // Migrate old settings if selectedModelId is missing
    if (!this.settings.selectedModelId) {
      if (this.settings.provider === 'openai') {
        const matchingModel = MODEL_OPTIONS.find(
          m => m.provider === 'openai' && m.apiModel === this.settings.openaiModel
        );
        this.settings.selectedModelId = matchingModel ? matchingModel.id : 'openai-gpt-4o';
      } else if (this.settings.provider === 'qwen') {
        const matchingModel = MODEL_OPTIONS.find(
          m => m.provider === 'qwen' && m.apiModel === this.settings.qwenModel
        );
        this.settings.selectedModelId = matchingModel ? matchingModel.id : 'qwen-vl-max';
      } else {
        this.settings.selectedModelId = 'qwen-vl-max';
      }
    }
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  private async convertImageInNoteFromFile(file: TFile) {
    try {
      const editor = this.app.workspace.activeEditor?.editor;
      if (!editor) {
        new Notice('❌ No active editor found');
        return;
      }

      const apiKey = this.getApiKey(this.settings.provider);
      if (!apiKey) {
        new Notice('❌ API Key not configured');
        return;
      }

      const notice = new Notice('Converting image...', 0);
      const imageData = await this.app.vault.readBinary(file);

      const provider = this.createProvider(apiKey);
      const converter = new PDFConverter(provider, {
        timeout: this.settings.timeout * 1000,
        maxRetries: this.settings.maxRetries,
      });

      const markdown = await converter.convertImageBuffer(imageData);

      // Find the line containing the image link in the editor
      const content = editor.getValue();
      const lines = content.split('\n');
      const fileName = file.name;
      const filePath = file.path;
      let insertLine = -1;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(fileName) || lines[i].includes(filePath)) {
          insertLine = i;
          break;
        }
      }

      if (insertLine === -1) {
        new Notice('❌ Could not find image line in editor');
        return;
      }

      const newContent =
        lines.slice(0, insertLine + 1).join('\n') +
        '\n\n' + markdown +
        '\n\n' +
        lines.slice(insertLine + 1).join('\n');

      editor.setValue(newContent);
      notice.setMessage(`✓ Image converted and inserted`);
      setTimeout(() => notice.hide(), 2000);
    } catch (error) {
      new Notice(`Error: ${error instanceof Error ? error.message : String(error)}`, 10000);
      console.error('Image conversion error:', error);
    }
  }

  private async convertImageInNote(imgElement: HTMLImageElement, src: string) {
    try {
      // Get the editor view
      const editor = this.app.workspace.activeEditor?.editor;
      if (!editor) {
        new Notice('❌ No active editor found');
        return;
      }

      // Resolve vault path from image src
      const vaultPath = this.resolveImagePath(src);
      if (!vaultPath) {
        new Notice('❌ Could not resolve image path');
        return;
      }

      // Read the image file
      const imageFile = this.app.vault.getAbstractFileByPath(vaultPath);
      if (!imageFile || !(imageFile instanceof TFile)) {
        new Notice('❌ Image file not found in vault');
        return;
      }

      const imageData = await this.app.vault.readBinary(imageFile);

      // Check API key
      const apiKey = this.getApiKey(this.settings.provider);
      if (!apiKey) {
        new Notice('❌ API Key not configured');
        return;
      }

      const notice = new Notice('Converting image...', 0);

      const provider = this.createProvider(apiKey);
      const converter = new PDFConverter(provider, {
        timeout: this.settings.timeout * 1000,
        maxRetries: this.settings.maxRetries,
      });

      const markdown = await converter.convertImageBuffer(imageData);

      // Find the image line in the editor and insert result below it
      const content = editor.getValue();
      const lines = content.split('\n');
      let insertLine = -1;

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes(vaultPath)) {
          insertLine = i;
          break;
        }
      }

      if (insertLine === -1) {
        new Notice('❌ Could not find image line in editor');
        return;
      }

      // Insert result after the image line
      const newContent =
        lines.slice(0, insertLine + 1).join('\n') +
        '\n\n' + markdown +
        '\n\n' +
        lines.slice(insertLine + 1).join('\n');

      editor.setValue(newContent);
      notice.setMessage(`✓ Image converted and inserted`);
      setTimeout(() => notice.hide(), 2000);
    } catch (error) {
      new Notice(`Error: ${error instanceof Error ? error.message : String(error)}`, 10000);
      console.error('Image conversion error:', error);
    }
  }

  private resolveImagePath(src: string): string | null {
    try {
      // If it's a relative path from markdown, resolve it
      if (src.startsWith('../') || src.startsWith('./')) {
        // Get current file path and resolve relative path
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) return null;

        const dir = activeFile.parent?.path || '';
        // Simple path resolution
        let resolved = src;
        if (src.startsWith('../')) {
          const parts = dir.split('/');
          let upCount = 0;
          let remaining = src;
          while (remaining.startsWith('../')) {
            upCount++;
            remaining = remaining.slice(3);
          }
          const newPath = parts.slice(0, parts.length - upCount).join('/');
          resolved = newPath ? newPath + '/' + remaining : remaining;
        } else if (src.startsWith('./')) {
          resolved = (dir ? dir + '/' : '') + src.slice(2);
        }
        return resolved;
      }

      // If it's already a vault path
      if (!src.startsWith('http') && !src.startsWith('data:')) {
        return src;
      }
    } catch (e) {
      console.error('Error resolving image path:', e);
    }

    return null;
  }
}
