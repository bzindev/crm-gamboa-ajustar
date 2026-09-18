import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";

export function PeriodForm({ from, to }: { from: string; to: string }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3 print:hidden">
      <div className="flex flex-col gap-2">
        <Label htmlFor="from">De</Label>
        <Input id="from" name="from" type="date" defaultValue={from} className="w-40" />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="to">Até</Label>
        <Input id="to" name="to" type="date" defaultValue={to} className="w-40" />
      </div>
      <Button type="submit" variant="outline">
        Filtrar
      </Button>
    </form>
  );
}
