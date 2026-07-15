import {
  SettingsMaintenanceService,
  type SettingsMaintenanceDependencies,
} from '../../../src/settings/SettingsMaintenanceService';

function makeDependencies(): jest.Mocked<SettingsMaintenanceDependencies> {
  return {
    deleteModel: jest.fn(async () => undefined),
    clearTemporaryFiles: jest.fn(async () => undefined),
    clearDiagnostics: jest.fn(async () => undefined),
    clearConversations: jest.fn(async () => undefined),
  };
}

describe('SettingsMaintenanceService', () => {
  it('keeps model and conversation deletion strictly isolated', async () => {
    const deps = makeDependencies();
    const service = new SettingsMaintenanceService(deps);

    await service.run('delete-model');
    expect(deps.deleteModel).toHaveBeenCalledTimes(1);
    expect(deps.clearConversations).not.toHaveBeenCalled();

    await service.run('clear-conversations');
    expect(deps.clearConversations).toHaveBeenCalledTimes(1);
    expect(deps.deleteModel).toHaveBeenCalledTimes(1);
  });

  it('runs temporary and diagnostic cleanup through their scoped services', async () => {
    const deps = makeDependencies();
    const service = new SettingsMaintenanceService(deps);

    await service.run('clear-temporary-files');
    await service.run('clear-diagnostics');

    expect(deps.clearTemporaryFiles).toHaveBeenCalledTimes(1);
    expect(deps.clearDiagnostics).toHaveBeenCalledTimes(1);
  });

  it('deduplicates repeated taps while the same operation is running', async () => {
    let finish!: () => void;
    const deps = makeDependencies();
    deps.deleteModel.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    const service = new SettingsMaintenanceService(deps);

    const first = service.run('delete-model');
    const second = service.run('delete-model');
    expect(service.isRunning('delete-model')).toBe(true);
    expect(deps.deleteModel).toHaveBeenCalledTimes(1);
    finish();

    await expect(first).resolves.toEqual({ status: 'success' });
    await expect(second).resolves.toEqual({ status: 'busy' });
    expect(service.isRunning('delete-model')).toBe(false);
  });

  it('returns a recoverable failure without throwing raw errors', async () => {
    const deps = makeDependencies();
    deps.clearDiagnostics.mockRejectedValue(new Error('/private/path failed'));
    const service = new SettingsMaintenanceService(deps);

    await expect(service.run('clear-diagnostics')).resolves.toEqual({ status: 'failed' });
    expect(service.isRunning('clear-diagnostics')).toBe(false);
  });
});
