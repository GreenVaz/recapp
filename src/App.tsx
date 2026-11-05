import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
import { useData } from './lib/store.js';
import { BottomNav } from './components/BottomNav.js';
import { FullScreenLoader } from './components/ui.js';
import { AuthScreen } from './screens/Auth.js';
import { HomeScreen } from './screens/Home.js';

/**
 * Екрани поза головною підвантажуються на вимогу. Перший запуск на
 * мобільному зв'язку тягне лише те, що видно одразу, а не весь застосунок.
 */
const CalendarScreen = lazy(() => import('./screens/Calendar.js').then((m) => ({ default: m.CalendarScreen })));
const LoansScreen = lazy(() => import('./screens/Loans.js').then((m) => ({ default: m.LoansScreen })));
const LoanDetailScreen = lazy(() => import('./screens/LoanDetail.js').then((m) => ({ default: m.LoanDetailScreen })));
const AnalyticsScreen = lazy(() => import('./screens/Analytics.js').then((m) => ({ default: m.AnalyticsScreen })));
const SettingsScreen = lazy(() => import('./screens/Settings.js').then((m) => ({ default: m.SettingsScreen })));
const AccountsScreen = lazy(() => import('./screens/Accounts.js').then((m) => ({ default: m.AccountsScreen })));
const CategoriesScreen = lazy(() => import('./screens/Categories.js').then((m) => ({ default: m.CategoriesScreen })));
const TransactionsScreen = lazy(() => import('./screens/Transactions.js').then((m) => ({ default: m.TransactionsScreen })));
const NewEntryScreen = lazy(() => import('./screens/NewEntry.js').then((m) => ({ default: m.NewEntryScreen })));

export function App() {
  const { status, error, isOffline, reload } = useData();

  if (status === 'loading') return <FullScreenLoader />;

  if (status === 'error') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
        <p className="text-sm text-expense">{error}</p>
        <button type="button" onClick={() => void reload()} className="btn-secondary">
          Спробувати ще раз
        </button>
      </div>
    );
  }

  if (status === 'anonymous') {
    return (
      <Routes>
        <Route path="/auth" element={<AuthScreen />} />
        <Route path="*" element={<Navigate to="/auth" replace />} />
      </Routes>
    );
  }

  return (
    <>
      {/* Офлайн показуємо явно: мовчазна помилка збереження гірша за банер. */}
      {isOffline && (
        <div
          role="status"
          className="sticky top-0 z-30 flex items-center justify-center gap-2 bg-debt/15 px-4 py-2 text-xs font-medium text-debt pt-safe"
        >
          <WifiOff size={14} />
          Немає зв’язку. Зміни не збережуться, доки інтернет не з’явиться.
        </div>
      )}

      <Suspense fallback={<FullScreenLoader />}>
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/calendar" element={<CalendarScreen />} />
          <Route path="/loans" element={<LoansScreen />} />
          <Route path="/loans/:id" element={<LoanDetailScreen />} />
          <Route path="/analytics" element={<AnalyticsScreen />} />
          <Route path="/transactions" element={<TransactionsScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="/settings/accounts" element={<AccountsScreen />} />
          <Route path="/settings/categories" element={<CategoriesScreen />} />
          <Route path="/new/:kind" element={<NewEntryScreen />} />
          <Route path="/auth" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>

      <BottomNav />
    </>
  );
}
