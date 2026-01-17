import csv

countries = ["United Kingdom", "France", "Japan"]
target_years = range(2004, 2025)

input_file = "energy_data.csv"
output_file = "energy_production.csv"

# Columns to extract: country, year, hydro_electricity, solar_electricity, wind_electricity
# We'll use the column names to be safe.

with open(input_file, mode='r', encoding='utf-8') as f:
    reader = csv.DictReader(f)
    data = []
    for row in reader:
        if row['country'] in countries and int(row['year']) in target_years:
            data.append({
                'Country': row['country'],
                'Year': row['year'],
                'Solar (TWh)': row['solar_electricity'] if row['solar_electricity'] else "0.0",
                'Wind (TWh)': row['wind_electricity'] if row['wind_electricity'] else "0.0",
                'Hydro (TWh)': row['hydro_electricity'] if row['hydro_electricity'] else "0.0"
            })

# Sort data by Country and then Year
data.sort(key=lambda x: (x['Country'], int(x['Year'])))

with open(output_file, mode='w', encoding='utf-8', newline='') as f:
    writer = csv.DictWriter(f, fieldnames=['Country', 'Year', 'Solar (TWh)', 'Wind (TWh)', 'Hydro (TWh)'])
    writer.writeheader()
    writer.writerows(data)

print(f"Data saved to {output_file}")
