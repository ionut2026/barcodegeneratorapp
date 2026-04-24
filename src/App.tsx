import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
// ONLY THIS LINE CHANGES: Swap BrowserRouter for HashRouter
import { HashRouter, Routes, Route } from "react-router-dom"; 
import Index from "./pages/Index";
import Analyzer from "./pages/Analyzer";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Sonner />
      {/* USE HASHROUTER HERE INSTEAD OF BROWSERROUTER */}
      <HashRouter> 
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/analyzer" element={<Analyzer />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </HashRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
