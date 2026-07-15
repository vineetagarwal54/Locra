export type SettingsMaintenanceOperation =
  | 'delete-model'
  | 'clear-temporary-files'
  | 'clear-diagnostics'
  | 'clear-conversations';

export interface SettingsMaintenanceDependencies {
  deleteModel(): Promise<void>;
  clearTemporaryFiles(): Promise<void>;
  clearDiagnostics(): Promise<void>;
  clearConversations(): Promise<void>;
}

export type SettingsMaintenanceResult =
  | { readonly status: 'success' }
  | { readonly status: 'busy' }
  | { readonly status: 'failed' };

export class SettingsMaintenanceService {
  private readonly running = new Set<SettingsMaintenanceOperation>();

  constructor(private readonly dependencies: SettingsMaintenanceDependencies) {}

  isRunning(operation: SettingsMaintenanceOperation): boolean {
    return this.running.has(operation);
  }

  async run(operation: SettingsMaintenanceOperation): Promise<SettingsMaintenanceResult> {
    if (this.running.has(operation)) return { status: 'busy' };
    this.running.add(operation);
    try {
      await this.execute(operation);
      return { status: 'success' };
    } catch {
      return { status: 'failed' };
    } finally {
      this.running.delete(operation);
    }
  }

  private execute(operation: SettingsMaintenanceOperation): Promise<void> {
    switch (operation) {
      case 'delete-model':
        return this.dependencies.deleteModel();
      case 'clear-temporary-files':
        return this.dependencies.clearTemporaryFiles();
      case 'clear-diagnostics':
        return this.dependencies.clearDiagnostics();
      case 'clear-conversations':
        return this.dependencies.clearConversations();
    }
  }
}
