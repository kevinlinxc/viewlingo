import dataset
import os

# Database file path (in the db folder)
db_path = os.path.join(os.path.dirname(__file__), 'translations.db')
db_url = f'sqlite:///{db_path}'

db = dataset.connect(db_url)

# Create table with the required schema if it doesn't exist
table = db.create_table('translations', primary_id='id', primary_type=dataset.types.Integer)

# Ensure columns exist (dataset will add them if missing)
table.create_column('word', dataset.types.String)
table.create_column('timestamp', dataset.types.DateTime)
table.create_column('translation', dataset.types.String)
table.create_column('anglosax', dataset.types.String)
table.create_column('picture', dataset.types.String)  # base64 can be large, so use String
table.create_column('language', dataset.types.String)

print('Database and table are set up!') 