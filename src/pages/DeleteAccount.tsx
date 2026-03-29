import { useEffect } from 'react';

export default function DeleteAccount() {
  useEffect(() => {
    document.title = 'Delete Seen Account | Seen Matters';
    const meta = document.querySelector('meta[name="description"]');
    if (meta) {
      meta.setAttribute('content', 'Learn how to delete your Seen account and permanently remove associated data.');
    } else {
      const tag = document.createElement('meta');
      tag.name = 'description';
      tag.content = 'Learn how to delete your Seen account and permanently remove associated data.';
      document.head.appendChild(tag);
    }
    return () => { document.title = 'Seen'; };
  }, []);

  return (
    <div className="fixed inset-0 bg-white overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-16 sm:py-24">
        {/* Header */}
        <div className="mb-12 text-center">
          <p className="text-xs tracking-[0.3em] uppercase text-muted mb-6">Seen</p>
          <h1 className="text-2xl sm:text-3xl font-light text-primary leading-tight">
            Delete Your Seen Account
          </h1>
          <p className="text-lg sm:text-xl font-light text-secondary mt-1">
            删除 Seen 账户
          </p>
        </div>

        <div className="space-y-14">
          {/* English */}
          <section>
            <h2 className="text-lg font-medium text-primary mb-4">Account Deletion Request</h2>
            <p className="text-sm text-secondary leading-relaxed mb-4">
              You can delete your account and all associated data directly within the Seen app:
            </p>
            <div className="bg-gray-50 rounded-xl px-5 py-4 mb-5">
              <p className="text-xs text-muted uppercase tracking-wider mb-1">Path</p>
              <p className="text-sm font-medium text-primary">
                Me → Privacy &amp; Data → Close Account and Delete All Data
              </p>
            </div>
            <p className="text-sm text-secondary mb-2">Once deleted:</p>
            <ul className="text-sm text-secondary space-y-1.5 ml-1">
              <li className="flex items-start gap-2"><span className="mt-1.5 w-1 h-1 rounded-full bg-gray-300 shrink-0" />All your data will be permanently removed</li>
              <li className="flex items-start gap-2"><span className="mt-1.5 w-1 h-1 rounded-full bg-gray-300 shrink-0" />Data cannot be recovered</li>
              <li className="flex items-start gap-2"><span className="mt-1.5 w-1 h-1 rounded-full bg-gray-300 shrink-0" />No copies will be retained</li>
            </ul>
            <p className="text-sm text-secondary mt-5 leading-relaxed">
              If you are unable to access the app, you may request deletion by contacting:{' '}
              <a href="mailto:support@beingseenmatters.com" className="underline underline-offset-2 text-primary">
                support@beingseenmatters.com
              </a>
            </p>
            <p className="text-sm text-secondary mt-2">
              We will process your request within 7 days.
            </p>
          </section>

          <hr className="border-gray-100" />

          {/* Chinese */}
          <section>
            <h2 className="text-lg font-medium text-primary mb-4">账户删除说明</h2>
            <p className="text-sm text-secondary leading-relaxed mb-4">
              你可以在 Seen App 内直接删除账户及所有数据：
            </p>
            <div className="bg-gray-50 rounded-xl px-5 py-4 mb-5">
              <p className="text-xs text-muted uppercase tracking-wider mb-1">路径</p>
              <p className="text-sm font-medium text-primary">
                我 → 隐私与数据 → 关闭账户并清除全部数据
              </p>
            </div>
            <p className="text-sm text-secondary mb-2">删除后：</p>
            <ul className="text-sm text-secondary space-y-1.5 ml-1">
              <li className="flex items-start gap-2"><span className="mt-1.5 w-1 h-1 rounded-full bg-gray-300 shrink-0" />所有数据将被永久删除</li>
              <li className="flex items-start gap-2"><span className="mt-1.5 w-1 h-1 rounded-full bg-gray-300 shrink-0" />数据不可恢复</li>
              <li className="flex items-start gap-2"><span className="mt-1.5 w-1 h-1 rounded-full bg-gray-300 shrink-0" />不会保留任何副本</li>
            </ul>
            <p className="text-sm text-secondary mt-5 leading-relaxed">
              如果无法访问 App，可通过以下方式申请删除：{' '}
              <a href="mailto:support@beingseenmatters.com" className="underline underline-offset-2 text-primary">
                support@beingseenmatters.com
              </a>
            </p>
            <p className="text-sm text-secondary mt-2">
              我们将在7天内处理请求。
            </p>
          </section>
        </div>

        {/* Footer */}
        <div className="mt-16 pt-8 border-t border-gray-100 text-center space-y-1">
          <p className="text-xs text-muted">
            Seen respects your privacy and gives you control over your data.
          </p>
          <p className="text-xs text-muted">
            Seen 尊重你的隐私，并将数据控制权交还给你。
          </p>
        </div>
      </div>
    </div>
  );
}
