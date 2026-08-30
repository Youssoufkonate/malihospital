import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import SuperAdmin from "./pages/SuperAdmin";
import AdminPanel from "./pages/AdminPanel";
import Accueil from "./pages/Accueil";
import Doctor from "./pages/Doctor";
import Nurse from "./pages/Nurse";
import Supervisor from "./pages/Supervisor";
import Pharmacy from "./pages/Pharmacy";
import FacilityAdmin from "./pages/FacilityAdmin";
import WaitingRoom from "./pages/WaitingRoom";
import ProtectedRoute from "./components/ProtectedRoute";
import SessionGuard from "./components/SessionGuard";

export default function App() {
  return (
    <BrowserRouter>
      {/* SessionGuard only arms its 2-hour idle timer once Firebase
          reports a signed-in user, so it's safe to wrap everything
          here (including the public Login/Signup/WaitingRoom routes)
          rather than duplicating the route tree. This is the ONLY
          session-idle mechanism in the app — Login.jsx no longer runs
          its own competing timer. */}
      <SessionGuard>
        <Routes>
          <Route path="/" element={<Login />} />

          {/* Only usable once, to bootstrap the very first Super Admin account */}
          <Route path="/signup" element={<Signup />} />

          <Route
            path="/superadmin"
            element={
              <ProtectedRoute roles={["superadmin"]}>
                <SuperAdmin />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin"
            element={
              <ProtectedRoute roles={["hospitaladmin"]}>
                <AdminPanel />
              </ProtectedRoute>
            }
          />

          <Route
            path="/accueil"
            element={
              <ProtectedRoute roles={["accueil"]}>
                <Accueil />
              </ProtectedRoute>
            }
          />

          <Route
            path="/doctor"
            element={
              <ProtectedRoute roles={["doctor"]}>
                <Doctor />
              </ProtectedRoute>
            }
          />

          <Route
            path="/nurse"
            element={
              <ProtectedRoute roles={["nurse"]}>
                <Nurse />
              </ProtectedRoute>
            }
          />

          <Route
            path="/supervisor"
            element={
              <ProtectedRoute roles={["supervisor"]}>
                <Supervisor />
              </ProtectedRoute>
            }
          />

          <Route
            path="/pharmacy"
            element={
              <ProtectedRoute roles={["pharmacy"]}>
                <Pharmacy />
              </ProtectedRoute>
            }
          />

          <Route
            path="/facility-admin"
            element={
              <ProtectedRoute roles={["facilityadmin"]}>
                <FacilityAdmin />
              </ProtectedRoute>
            }
          />

          {/* Public, no-login TV/display screen — one unique link per hospital,
              e.g. https://yourapp.com/waiting/HOSPITAL_ID_HERE */}
          <Route path="/waiting/:hospitalId" element={<WaitingRoom />} />
        </Routes>
      </SessionGuard>
    </BrowserRouter>
  );
}