import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import Admin from "./pages/Admin";
import Accueil from "./pages/Accueil";
import Doctor from "./pages/Doctor";
import WaitingRoom from "./pages/WaitingRoom";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="/accueil" element={<Accueil />} />
        <Route path="/doctor" element={<Doctor />} />
        <Route path="/waiting" element={<WaitingRoom />} />
      </Routes>
    </BrowserRouter>
  );
}