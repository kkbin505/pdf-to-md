import { App, PluginSettingTab, Setting, Notice, Platform } from 'obsidian';
import PDFToMDPlugin from '../main';

export interface ModelOption {
  id: string;
  name: string;
  provider: 'openai' | 'qwen' | 'gemini' | 'claude' | 'local';
  apiModel: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  { id: 'openai-gpt-4o', name: 'OpenAI GPT-4o', provider: 'openai', apiModel: 'gpt-4o' },
  { id: 'openai-gpt-4o-mini', name: 'OpenAI GPT-4o Mini', provider: 'openai', apiModel: 'gpt-4o-mini' },
  { id: 'openai-gpt-4.1', name: 'OpenAI GPT-4.1', provider: 'openai', apiModel: 'gpt-4.1' },
  { id: 'openai-gpt-4.1-mini', name: 'OpenAI GPT-4.1 Mini', provider: 'openai', apiModel: 'gpt-4.1-mini' },
  { id: 'openai-gpt-5.4-mini', name: 'OpenAI GPT-5.4 Mini', provider: 'openai', apiModel: 'gpt-5.4-mini' },
  { id: 'openai-gpt-5.4', name: 'OpenAI GPT-5.4', provider: 'openai', apiModel: 'gpt-5.4' },
  { id: 'gemini-3.5-flash', name: 'Google Gemini 3.5 Flash', provider: 'gemini', apiModel: 'gemini-3.5-flash' },
  { id: 'gemini-2.5-flash', name: 'Google Gemini 2.5 Flash', provider: 'gemini', apiModel: 'gemini-2.5-flash' },
  { id: 'gemini-2.5-flash-lite', name: 'Google Gemini 2.5 Flash-Lite Preview 06-17', provider: 'gemini', apiModel: 'gemini-2.5-flash-lite-preview-06-17' },
  { id: 'gemini-2.5-pro', name: 'Google Gemini 2.5 Pro', provider: 'gemini', apiModel: 'gemini-2.5-pro' },
  { id: 'qwen-vl-max', name: 'Alibaba Qwen VL Max (千问)', provider: 'qwen', apiModel: 'qwen-vl-max' },
  { id: 'qwen-vl-plus', name: 'Alibaba Qwen VL Plus (千问)', provider: 'qwen', apiModel: 'qwen-vl-plus' },
  { id: 'qwen-vl-max-latest', name: 'Alibaba Qwen VL Max Latest (千问)', provider: 'qwen', apiModel: 'qwen-vl-max-latest' },
  { id: 'claude-opus-4-7', name: 'Anthropic Claude Opus 4', provider: 'claude', apiModel: 'claude-opus-4-7' },
  { id: 'claude-sonnet-4-6', name: 'Anthropic Claude Sonnet 4', provider: 'claude', apiModel: 'claude-sonnet-4-6' },
  { id: 'claude-haiku-4-5', name: 'Anthropic Claude Haiku 4.5', provider: 'claude', apiModel: 'claude-haiku-4-5-20251001' },
  { id: 'local-openai', name: 'Local (Ollama / LM Studio / llama.cpp)', provider: 'local', apiModel: 'local' },
];

export interface PDFToMDSettings {
  provider: 'openai' | 'qwen' | 'gemini' | 'claude' | 'local';
  selectedModelId: string;
  openaiModel: string;
  qwenModel: string;
  customBaseUrl: string;
  customModelName: string;
  localBaseUrl: string;
  localModel: string;
  dpi: number;
  timeout: number;
  conflictResolution: 'overwrite' | 'skip' | 'timestamp' | 'by-model';
}

export const DEFAULT_SETTINGS: PDFToMDSettings = {
  provider: 'qwen',
  selectedModelId: 'qwen-vl-max',
  openaiModel: 'gpt-5.4-mini',
  qwenModel: 'qwen-vl-max',
  customBaseUrl: '',
  customModelName: '',
  localBaseUrl: 'http://localhost:11434/v1',
  localModel: 'glm-ocr:bf16',
  dpi: 150,
  timeout: 60,
  conflictResolution: 'by-model',
};

export class PDFToMDSettingTab extends PluginSettingTab {
  plugin: PDFToMDPlugin;

  constructor(app: App, plugin: PDFToMDPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // 🔒 Security notice (hidden for local — no key needed)
    if (this.plugin.settings.provider !== 'local') {
      const securityNotice = containerEl.createDiv('pdf-to-md-security-notice');
      const noticeText = Platform.isIosApp
        ? '<strong>🔒 Security:</strong> API keys are stored securely in <strong>iOS Keychain</strong> and are not synced.'
        : '<strong>🔒 Security:</strong> API keys are read from environment variables only. <strong>No API keys are stored on disk.</strong>';
      securityNotice.innerHTML = `
        <div style="margin-bottom: 20px; padding: 12px; background: #f0f7ff; border-left: 4px solid #2196f3; border-radius: 4px;">
          ${noticeText}
          <br/>
          <small>See <a href="https://github.com/kkbin505/pdf-to-md">documentation</a> for setup instructions.</small>
        </div>
      `;
    }

    // Model selection dropdown
    new Setting(containerEl)
      .setName('Model')
      .setDesc('Select the AI model to use for recognition')
      .addDropdown(dropdown => {
        MODEL_OPTIONS.forEach(option => {
          dropdown.addOption(option.id, option.name);
        });
        dropdown
          .setValue(this.plugin.settings.selectedModelId || 'qwen-vl-max')
          .onChange(async value => {
            const selected = MODEL_OPTIONS.find(m => m.id === value) || MODEL_OPTIONS[0];
            this.plugin.settings.selectedModelId = value;
            this.plugin.settings.provider = selected.provider;
            
            // Set default models for backward compatibility and provider configs
            if (selected.provider === 'openai') {
              this.plugin.settings.openaiModel = selected.apiModel;
            } else if (selected.provider === 'qwen') {
              this.plugin.settings.qwenModel = selected.apiModel;
            }
            
            await this.plugin.saveSettings();
            this.display();
          });
      });

    // Provider-specific settings
    this.displayProviderSettings();

    // DPI setting
    new Setting(containerEl)
      .setName('PDF Rendering DPI')
      .setDesc('Higher DPI = better quality but slower')
      .addSlider(slider => {
        const label = document.createElement('span');
        label.textContent = `${this.plugin.settings.dpi}`;
        label.style.cssText = 'min-width:36px;text-align:right;font-variant-numeric:tabular-nums';
        slider.sliderEl.insertAdjacentElement('afterend', label);

        slider
          .setLimits(50, 300, 50)
          .setValue(this.plugin.settings.dpi)
          .onChange(async value => {
            this.plugin.settings.dpi = value;
            label.textContent = `${value}`;
            await this.plugin.saveSettings();
          });
      })
      .addExtraButton(button =>
        button.setIcon('reset').onClick(async () => {
          this.plugin.settings.dpi = 200;
          await this.plugin.saveSettings();
          this.display();
        })
      );

    // Timeout setting
    new Setting(containerEl)
      .setName('API Timeout (seconds)')
      .setDesc('Maximum time to wait for API response')
      .addText(text =>
        text
          .setPlaceholder('60')
          .setValue(String(this.plugin.settings.timeout))
          .onChange(async value => {
            const num = parseInt(value);
            if (!isNaN(num) && num > 0) {
              this.plugin.settings.timeout = num;
              await this.plugin.saveSettings();
            }
          })
      );


    // File conflict handling
    new Setting(containerEl)
      .setName('File Conflict Resolution')
      .setDesc('What to do if output file already exists')
      .addDropdown(dropdown =>
        dropdown
          .addOption('overwrite', 'Overwrite existing file')
          .addOption('skip', 'Skip (do not generate)')
          .addOption('timestamp', 'Add timestamp (e.g., file_20250515_110430.md)')
          .addOption('by-model', 'Add model name (e.g., file_qwen.md) - Recommended')
          .setValue(this.plugin.settings.conflictResolution)
          .onChange(async value => {
            this.plugin.settings.conflictResolution = value as any;
            await this.plugin.saveSettings();
          })
      );
  }

  private displayProviderSettings(): void {
    const provider = this.plugin.settings.provider;

    switch (provider) {
      case 'openai':
        this.addProviderSetting(
          'openai',
          'OpenAI API Key Status',
          'Get from https://platform.openai.com/api-keys',
          'OPENAI_API_KEY'
        );
        break;
      case 'qwen':
        this.addProviderSetting(
          'qwen',
          'Alibaba DashScope API Key Status',
          'Get from https://dashscope.console.aliyun.com/apiKey',
          'DASHSCOPE_API_KEY'
        );
        break;
      case 'gemini':
        this.addProviderSetting(
          'gemini',
          'Google Gemini API Key Status',
          'Get from Google AI Studio / Generative AI console',
          'GEMINI_API_KEY'
        );
        break;
      case 'claude':
        this.addProviderSetting(
          'claude',
          'Anthropic API Key Status',
          'Get from https://console.anthropic.com/settings/keys',
          'ANTHROPIC_API_KEY'
        );
        break;
      case 'local':
        this.addLocalSettings();
        break;
    }
  }

  private addLocalSettings(): void {
    const { containerEl } = this;

    new Setting(containerEl)
      .setName('Base URL')
      .setDesc('OpenAI-compatible endpoint (Ollama, LM Studio, llama.cpp, vLLM, etc.)')
      .addText(text =>
        text
          .setPlaceholder('http://localhost:11434/v1')
          .setValue(this.plugin.settings.localBaseUrl)
          .onChange(async value => {
            this.plugin.settings.localBaseUrl = value.trim() || 'http://localhost:11434/v1';
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName('Model')
      .setDesc('Vision model name (must support image input, e.g. gemma3:4b, llava, llama3.2-vision)')
      .addText(text =>
        text
          .setPlaceholder('gemma3:4b')
          .setValue(this.plugin.settings.localModel)
          .onChange(async value => {
            this.plugin.settings.localModel = value.trim() || 'gemma3:4b';
            await this.plugin.saveSettings();
          })
      );

    if (Platform.isIosApp) {
      const secretStorage = (this.app as any).secretStorage;
      if (secretStorage) {
        const isConfigured = !!this.plugin.apiKeys.get('local');
        new Setting(containerEl)
          .setName('API Key')
          .setDesc('Optional — stored securely in iOS Keychain (not synced). Leave empty for local endpoints.')
          .addText(text => {
            text.inputEl.type = 'password';
            text.setPlaceholder(isConfigured ? '••••••••••••••••' : 'Enter API key (optional)...')
              .onChange(async value => {
                const val = value.trim();
                this.plugin.apiKeys.set('local', val);
                try {
                  if (val) {
                    await secretStorage.setSecret('pdf-to-md-local-key', val);
                  } else {
                    await secretStorage.deleteSecret('pdf-to-md-local-key');
                  }
                } catch (e) {
                  console.error('Failed to save local API key to Keychain:', e);
                  new Notice('Failed to save API key to Keychain', 5000);
                }
              });
          });
      }
    } else if (!Platform.isAndroidApp) {
      // Desktop only: show optional env var status
      const envValue = this.getEnvValue('LOCAL_LLM_API_KEY');
      new Setting(containerEl)
        .setName('API Key (Optional)')
        .setDesc('Set environment variable `LOCAL_LLM_API_KEY` if your endpoint requires authentication. Not needed for local servers.')
        .addText(text =>
          text
            .setValue(envValue ? '✓ Configured' : '✗ Not set (optional)')
            .setDisabled(true)
        );
    }
    // Android: no API key UI
  }

  private addProviderSetting(
    provider: string,
    keyLabel: string,
    keyDesc: string,
    envVarName: string
  ): void {
    const { containerEl } = this;

    if (Platform.isIosApp) {
      const secretStorage = (this.app as any).secretStorage;
      if (secretStorage) {
        const isConfigured = !!this.plugin.apiKeys.get(provider);
        new Setting(containerEl)
          .setName(keyLabel)
          .setDesc(`${keyDesc}\n**Stored securely in iOS Keychain (not synced).**`)
          .addText(text => {
            text.inputEl.type = 'password';
            text.setPlaceholder(isConfigured ? '••••••••••••••••' : 'Enter API key...')
              .onChange(async value => {
                const val = value.trim();
                if (!val) return;
                this.plugin.apiKeys.set(provider, val);
                try {
                  await secretStorage.setSecret(`pdf-to-md-${provider}-key`, val);
                } catch (e) {
                  console.error(`Failed to save secret for ${provider}:`, e);
                  new Notice(`Failed to save API key to Keychain`, 5000);
                }
              });
          });
        return;
      }
    }

    const envValue = this.getEnvValue(envVarName);

    // Show API Key status (read-only)
    new Setting(containerEl)
      .setName(keyLabel)
      .setDesc(`${keyDesc}\n**Environment Variable:** \`${envVarName}\``)
      .addText(text =>
        text
          .setPlaceholder('Loading from environment variable...')
          .setValue(envValue ? '✓ Configured' : '✗ Not configured')
          .setDisabled(true)
      )
      .addButton(button =>
        button
          .setButtonText(envValue ? '✓ Found' : '⚠️ Missing')
          .setClass(envValue ? 'mod-cta' : 'mod-warning')
          .onClick(async () => {
            if (envValue) {
              new Notice(`✓ ${envVarName} is configured`, 3000);
            } else {
              new Notice(
                `⚠️ ${envVarName} not found.\n\nPlease set the environment variable and restart Obsidian.`,
                5000
              );
            }
          })
      );
  }

  private getEnvValue(envVarName: string): string | null {
    try {
      if (typeof process !== 'undefined' && process.env) {
        return process.env[envVarName] || null;
      }
    } catch (e) {
      // Silently fail if not in Electron environment
    }
    return null;
  }
}
