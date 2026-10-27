import AppKit
import Combine
import SwiftUI

@MainActor final class AppModel: ObservableObject {
  let backend: Backend
  @Published var settings: Preferences
  @Published var report = Report(status: "loading", message: "Проверяем Zen…")
  @Published var error: String?
  @Published var needsAppManagement = false
  @Published var busy = false
  @Published var update: SignedUpdate?
  @Published var updateNote: String?
  @Published var isInstalled = false
  private var pending: Task<Void, Never>?
  init() {
    backend = try! Backend()
    settings = backend.preferences()
    refresh()
    Task { await checkUpdates() }
  }
  func refresh() {
    isInstalled = backend.installed
    do { report = try backend.report() } catch {
      report = Report(status: "error", message: error.localizedDescription)
    }
  }
  func save() {
    pending?.cancel()
    pending = Task {
      try? await Task.sleep(for: .milliseconds(200))
      guard !Task.isCancelled else { return }
      do {
        try backend.savePreferences(settings)
        settings = backend.preferences()
        refresh()
      } catch { self.error = error.localizedDescription }
    }
  }
  func install() {
    busy = true
    error = nil
    Task {
      do {
        try backend.install()
        try backend.installGuard()
        settings = backend.preferences()
        refresh()
      } catch {
        if (error as NSError).code == NSFileWriteNoPermissionError {
          needsAppManagement = true
          self.error =
            "macOS не разрешила изменить загрузчик в Zen.app. Разрешите Zen Companion управление приложениями, затем повторите установку."
        } else {
          self.error = error.localizedDescription
        }
      }
      busy = false
    }
  }
  func checkUpdates() async {
    do {
      update = try await Updates.check()
      updateNote =
        update == nil
        ? "Доступных обновлений нет" : "Доступен Zen Companion \(update!.version)"
    } catch { updateNote = "Не удалось проверить обновления: \(error.localizedDescription)" }
  }
  func installUpdate() {
    guard let u = update else { return }
    busy = true
    Task {
      do {
        try await Updates.install(u, applyImprovements: backend.installed)
        let url = Bundle.main.bundleURL
        NSWorkspace.shared.openApplication(
          at: url,
          configuration: {
            let c = NSWorkspace.OpenConfiguration()
            c.createsNewApplicationInstance = true
            return c
          }()
        ) { _, _ in NSApplication.shared.terminate(nil) }
      } catch {
        self.error = error.localizedDescription
        busy = false
      }
    }
  }
  func chooseProfile() {
    let p = NSOpenPanel()
    p.canChooseDirectories = true
    p.canChooseFiles = false
    p.message = "Выберите папку профиля Zen (в ней находится prefs.js)."
    if p.runModal() == .OK, let u = p.url {
      backend.config.profile = u.path
      settings = backend.preferences()
      refresh()
    }
  }
  func restore() {
    let a = NSAlert()
    a.messageText = "Восстановить предыдущую установку?"
    a.informativeText =
      "Zen должен быть закрыт. Вернутся настройки и файлы, сохранённые перед последней установкой. История, пароли и вкладки не затрагиваются."
    a.addButton(withTitle: "Восстановить")
    a.addButton(withTitle: "Отмена")
    if a.runModal() == .alertFirstButtonReturn {
      do {
        try backend.restoreLast()
        settings = backend.preferences()
        refresh()
      } catch { self.error = error.localizedDescription }
    }
  }
  func uninstall() {
    let a = NSAlert()
    a.messageText = "Удалить улучшения из Zen?"
    a.informativeText =
      "Zen должен быть закрыт. Перед удалением будет создана резервная копия. Данные браузера и другие моды останутся."
    a.addButton(withTitle: "Удалить улучшения")
    a.addButton(withTitle: "Отмена")
    if a.runModal() == .alertFirstButtonReturn {
      do {
        try backend.uninstall()
        refresh()
      } catch { self.error = error.localizedDescription }
    }
  }
}
struct MainView: View {
  @StateObject var model = AppModel()
  let timer = Timer.publish(every: 2, on: .main, in: .common).autoconnect()
  var body: some View {
    VStack(alignment: .leading, spacing: 24) {
      HStack(spacing: 12) {
        Image(systemName: "sparkles.rectangle.stack").font(.system(size: 32)).foregroundStyle(.tint)
        VStack(alignment: .leading, spacing: 3) {
          Text("Zen Companion").font(.title2.weight(.semibold))
          Text("Улучшения для Zen").foregroundStyle(.secondary)
        }
        Spacer()
        Menu {
          Button("Проверить обновления") { Task { await model.checkUpdates() } }
          Divider()
          Button("Выбрать профиль…") { model.chooseProfile() }
          Button("Открыть резервные копии") {
            try? fm.createDirectory(
              at: model.backend.base.appendingPathComponent("backups"),
              withIntermediateDirectories: true)
            NSWorkspace.shared.open(model.backend.base.appendingPathComponent("backups"))
          }
          Button("Восстановить предыдущую установку…") { model.restore() }
          Divider()
          Button("Удалить улучшения…", role: .destructive) { model.uninstall() }
        } label: {
          Image(systemName: "ellipsis.circle").font(.title3)
        }.menuStyle(.borderlessButton).fixedSize().help("Обслуживание")
      }
      VStack(alignment: .leading, spacing: 22) {
        Toggle("Улучшения", isOn: $model.settings.enabled).toggleStyle(.switch).onChange(
          of: model.settings.enabled
        ) { _, _ in model.save() }
        Picker("Оформление", selection: Binding(
          get: { model.settings.appearance ?? "glass" },
          set: { model.settings.appearance = $0; model.save() }
        )) {
          Text("Стекло").tag("glass")
          Text("Универсальное").tag("universal")
        }.pickerStyle(.segmented).disabled(!model.settings.enabled)
        VStack(alignment: .leading, spacing: 10) {
          HStack {
            Text("Прозрачность")
            Spacer()
            Text("\(model.settings.transparency)%").monospacedDigit().foregroundStyle(.secondary)
          }
          Slider(
            value: Binding(
              get: { Double(model.settings.transparency) },
              set: {
                model.settings.transparency = Int($0)
                model.save()
              }), in: 0...100, step: 10
          ).accessibilityLabel("Прозрачность")
          HStack {
            Text("Плотнее")
            Spacer()
            Text("Прозрачнее")
          }.font(.caption).foregroundStyle(.secondary)
        }.disabled(!model.settings.enabled)
      }.padding(20).background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 16))
      HStack(alignment: .top, spacing: 10) {
        Image(
          systemName: model.report.status == "blocked"
            || (model.report.status == "error" || model.report.status == "permission")
            ? "exclamationmark.triangle"
            : model.report.restartRequired ? "arrow.clockwise" : "checkmark.circle"
        ).foregroundStyle(
          model.report.status == "blocked"
            || (model.report.status == "error" || model.report.status == "permission")
            ? Color.orange : Color.secondary)
        VStack(alignment: .leading, spacing: 5) {
          Text(model.report.message).font(.callout)
          if let version = model.report.version {
            Text("Zen \(version) · пакет 2.3.54").font(.caption).foregroundStyle(.secondary)
          }
        }
        Spacer()
      }.frame(minHeight: 50, alignment: .top)
      if let note = model.updateNote { Text(note).font(.caption).foregroundStyle(.secondary) }
      if model.needsAppManagement || model.report.status == "permission" {
        Button("Открыть «Управление приложениями»") {
          NSWorkspace.shared.open(
            URL(
              string: "x-apple.systempreferences:com.apple.preference.security?Privacy_AppBundles")!
          )
        }
      }
      if let e = model.error {
        Text(e).font(.callout).foregroundStyle(.red).textSelection(.enabled)
      }
      HStack {
        Text(Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "").font(
          .caption
        ).foregroundStyle(.tertiary)
        Spacer()
        if model.busy { ProgressView().controlSize(.small) }
        Button(
          model.update != nil
            ? "Обновить Zen Companion"
            : model.isInstalled ? "Обновить улучшения" : "Установить улучшения"
        ) { if model.update != nil { model.installUpdate() } else { model.install() } }.buttonStyle(
          .borderedProminent
        ).disabled(model.busy || (model.report.status == "blocked" && model.update == nil))
      }
    }.padding(26).frame(width: 440).onReceive(timer) { _ in if !model.busy { model.refresh() } }
  }
}
struct ZenCompanionApp: App {
  var body: some Scene {
    WindowGroup("Zen Companion") { MainView() }.windowResizability(.contentSize).commands {
      CommandGroup(replacing: .newItem) {}
    }
  }
}
