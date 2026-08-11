import { getFoods, getNutrition } from '@/lib/backend';
import { Masthead, Rule, Empty, Fault } from '@/components/ui';
import { NutritionChart } from '@/components/NutritionChart';
import { FoodsList } from '@/components/FoodsList';
import { Reveal } from '@/components/motion';

export const dynamic = 'force-dynamic';

export default async function Food() {
  // Asks for one more than it shows, purely to detect the cap. A list that truncates without
  // saying so is the failure mode this replaces pagination with.
  const LIMIT = 120;
  const [nutrition, foods] = await Promise.all([getNutrition(30), getFoods(30, LIMIT + 1)]);

  return (
    <main className="screen">
      <Masthead left="Food" right="30 days" />

      <Reveal>
        {nutrition.ok ? (
          nutrition.rows.length > 0 ? (
            <NutritionChart rows={nutrition.rows} />
          ) : (
            <Empty>No meals logged in the last 30 days.</Empty>
          )
        ) : (
          <Fault error={nutrition.error} />
        )}
      </Reveal>

      <Rule />

      <Reveal delay={80}>
        {foods.ok ? (
          foods.rows.length > 0 ? (
            <FoodsList rows={foods.rows.slice(0, LIMIT)} capped={foods.rows.length > LIMIT} />
          ) : (
            <Empty>No meals logged in the last 30 days. Foods appear here as you eat them.</Empty>
          )
        ) : (
          <Fault error={foods.error} />
        )}
      </Reveal>
    </main>
  );
}
