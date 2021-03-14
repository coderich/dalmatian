// const Neo4j = require('neodb');
// const Redis = require('redis-mock');
const { set } = require('lodash');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { timeout } = require('../src/service/app.service');
const Schema = require('../src/core/Schema');
const Resolver = require('../src/core/Resolver');
const gql = require('./fixtures/schema');
const stores = require('./stores');


let resolver;
let richard;
let christie;
let mobyDick;
let healthBook;
let chapter1;
let chapter2;
let chapter3;
let page1;
let page2;
let page3;
let page4;
let page5;
let bookBuilding;
let libraryBuilding;
let apartmentBuilding;
let bookstore1;
let bookstore2;
let library;
let apartment;
let artsy;

const sorter = (a, b) => {
  const idA = `${a.id}`;
  const idB = `${b.id}`;
  if (idA < idB) return -1;
  if (idA > idB) return 1;
  return 0;
};

module.exports = (driver = 'mongo', options = {}) => {
  describe(`${driver} (${JSON.stringify(options)})`, () => {
    beforeAll(async () => {
      jest.setTimeout(60000);

      // Switch the default driver for testing
      stores.default = stores[driver];

      // If default/mongo; start in memory server unless we have to test transactions false
      if (driver === 'mongo') {
        if (options.transactions === false) {
          set(stores.default, 'directives.transactions', false);
        } else {
          const mongoServer = new MongoMemoryReplSet({ replSet: { storageEngine: 'wiredTiger' } });
          await mongoServer.waitUntilRunning();
          stores.default.uri = await mongoServer.getUri();
        }
      }

      // Create core classes
      const schema = new Schema(gql, stores);
      schema.getServerApiSchema();
      schema.makeExecutableSchema();
      resolver = new Resolver(schema, { network: { id: 'networkId' } });
      await schema.setup();

      //
      await timeout(2000);
      await Promise.all(schema.getModels().map(model => model.drop()));
      await timeout(500);
    });


    describe('Create', () => {
      test('Person', async () => {
        richard = await resolver.match('Person').save({ age: 40, name: 'Richard', status: 'alive', state: 'NJ', emailAddress: 'rich@coderich.com', network: 'network' });
        expect(richard.id).toBeDefined();
        expect(richard.name).toBe('Richard');
        expect(richard.telephone).toBe('###-###-####'); // Default value

        christie = await resolver.match('Person').save({ name: 'Christie', emailAddress: 'christie@gmail.com', friends: [richard.id], telephone: 1112223333, network: 'network', nonsense: 'nonsense' });
        expect(christie.id).toBeDefined();
        expect(christie.friends).toEqual([richard.id]);
        expect(christie.nonsense).not.toBeDefined();
        expect(christie.telephone).toBe('1112223333'); // Explicitly set

        // Tricky data stuff
        expect(richard.status).toBe('alive');
        expect(await richard.$status).toBe('alive');
        expect(richard.state).not.toBeDefined(); // DB key should be stripped
        expect(richard.network).toBe('networkId');
        expect(await richard.$network).toBe('networkId');
        expect(await richard.$authored).toEqual([]);
      });

      test('Book', async () => {
        mobyDick = await resolver.match('Book').save({ name: 'moby dick', price: 9.99, bids: [1.99, 1.20, 5.00], bestSeller: true, author: richard.id });
        expect(mobyDick.id).toBeDefined();
        expect(mobyDick.name).toBe('Moby Dick');
        expect(mobyDick.price).toBe(9.99);
        expect(mobyDick.author).toBe(richard.id);

        healthBook = await resolver.match('Book').save({ name: 'Health and Wellness', bids: [5.00, 9.00, 12.50], price: '29.99', author: christie.id });
        expect(healthBook.id).toBeDefined();
        expect(healthBook.name).toEqual('Health And Wellness');
        expect(healthBook.price).toEqual(29.99);
        expect(healthBook.author).toEqual(christie.id);
      });

      test('Chapter', async () => {
        chapter1 = await resolver.match('Chapter').save({ name: 'chapter1', book: healthBook.id });
        chapter2 = await resolver.match('Chapter').save({ name: 'chapter2', book: healthBook.id });
        chapter3 = await resolver.match('Chapter').save({ name: 'newChapter', book: mobyDick.id });
        expect(chapter1.id).toBeDefined();
        expect(chapter1.name).toEqual('Chapter1');
        expect(chapter2.id).toBeDefined();
        expect(chapter2.name).toEqual('Chapter2');
        expect(chapter3.id).toBeDefined();
        expect(chapter3.name).toEqual('Newchapter');
      });

      test('Page', async () => {
        page1 = await resolver.match('Page').save({ number: 1, chapter: chapter1.id, verbage: 'This is the introduction, of sorts.' });
        page2 = await resolver.match('Page').save({ number: 2, chapter: chapter1.id, verbage: 'Now you know.' });
        page3 = await resolver.match('Page').save({ number: 1, chapter: chapter2.id, verbage: 'Ready for more?' });
        page4 = await resolver.match('Page').save({ number: 2, chapter: chapter2.id, verbage: 'The end.' });
        page5 = await resolver.match('Page').save({ number: 1, chapter: chapter3.id, verbage: 'Moby Dick.' });
        await resolver.match('Page').save({ number: 3, chapter: chapter2.id, verbage: 'The real end.' });
        expect(page1.id).toBeDefined();
        expect(page2.id).toBeDefined();
        expect(page3.id).toBeDefined();
        expect(page4.id).toBeDefined();
        expect(page5.id).toBeDefined();
      });

      test('Building', async () => {
        bookBuilding = { year: 1990, type: 'business', tenants: [christie.id] };
        libraryBuilding = { type: 'business', tenants: [christie.id] };
        apartmentBuilding = { type: 'home', year: 1980, tenants: [richard.id, christie.id], landlord: richard.id };
        expect(1).toBe(1);
      });

      test('BookStore', async () => {
        bookstore1 = await resolver.match('BookStore').save({ name: 'Best Books Ever', books: [mobyDick.id, mobyDick.id, healthBook.id], building: bookBuilding });
        bookstore2 = await resolver.match('BookStore').save({ name: 'New Books', books: [mobyDick.id], building: Object.assign({}, bookBuilding, { description: 'A building' }) });
        expect(bookstore1.id).toBeDefined();
        expect(bookstore1.books.length).toEqual(3);
        expect(bookstore1.building.type).toEqual('business');
        expect(bookstore1.building.description).toEqual('A building from the bloom');
        expect(bookstore2.id).toBeDefined();
        expect(bookstore2.books.length).toEqual(1);
        expect(bookstore2.building.type).toEqual('business');
        expect(bookstore2.building.description).toEqual('A building');
        expect(await bookstore2.building.$description).toEqual('A building');
        expect(bookBuilding.description).not.toBeDefined();
      });

      test('Library', async () => {
        library = await resolver.match('Library').save({ name: 'Public Library', books: [mobyDick.id, healthBook.id, healthBook.id], building: libraryBuilding });
        expect(library.id).toBeDefined();
        expect(library.books.length).toEqual(3);
        expect(library.building.type).toEqual('business');
      });

      test('Apartment', async () => {
        apartment = await resolver.match('Apartment').save({ name: 'Piedmont Beauty', building: apartmentBuilding });
        expect(apartment.id).toBeDefined();
        expect(apartment.building.type).toEqual('home');
        expect(apartment.building.tenants).toEqual([richard.id, christie.id]);
      });

      test('Art', async () => {
        artsy = await resolver.match('Art').save({ name: 'My Find Art', sections: [{ name: 'Section1' }] });
        expect(artsy.id).toBeDefined();
        expect(artsy.sections).toMatchObject([{ name: 'section1' }]);
        expect(artsy.sections[0].id).toBeDefined();
      });
    });


    describe('Get', () => {
      test('Person', async () => {
        expect(await resolver.match('Person').one()).toBeDefined();
        expect(await resolver.match('Person').id(richard.id).one()).toMatchObject({ id: richard.id, name: richard.name, network: 'networkId' });
        expect(await resolver.match('Person').id(christie.id).one()).toMatchObject({ id: christie.id, name: christie.name, friends: [richard.id], network: 'networkId' });
        expect(await resolver.match('Person').id(christie.id).many()).toMatchObject([{ id: christie.id, name: christie.name, friends: [richard.id], network: 'networkId' }]);
        expect(await resolver.match('Person').where({ age: 40 }).one()).toMatchObject({ id: richard.id, name: richard.name, network: 'networkId' });
        expect(await resolver.match('Person').where({ age: '40' }).one()).toMatchObject({ id: richard.id, name: richard.name, network: 'networkId' });
        expect(await resolver.match('Person').where({ age: '4?' }).one()).toMatchObject({ id: richard.id, name: richard.name, network: 'networkId' });
        expect(await resolver.match('Person').where({ age: '??' }).one()).toMatchObject({ id: richard.id, name: richard.name, network: 'networkId' });

        // Context switch
        const ctx = resolver.getContext();
        ctx.network.id = 'networkIdd';
        await expect(resolver.match('Person').where({ name: richard.name }).one({ required: true })).rejects.toThrow();
        ctx.network.id = 'networkId';
      });

      test('Book', async () => {
        expect(await resolver.match('Book').id(mobyDick.id).one()).toMatchObject({ id: mobyDick.id, name: 'Moby Dick', author: richard.id });
        expect(await resolver.match('Book').id(healthBook.id).one()).toMatchObject({ id: healthBook.id, name: 'Health And Wellness', author: christie.id });
        expect(await resolver.match('Book').where({ 'author.id': christie.id }).one()).toMatchObject({ id: healthBook.id, name: 'Health And Wellness', author: christie.id });
        expect(await resolver.match('Book').where({ 'author.id': `${christie.id}` }).one()).toMatchObject({ id: healthBook.id, name: 'Health And Wellness', author: christie.id });
      });

      test('Chapter', async () => {
        expect(await resolver.match('Chapter').id(chapter1.id).one()).toMatchObject({ id: chapter1.id, name: 'Chapter1', book: healthBook.id });
        expect(await resolver.match('Chapter').id(chapter2.id).one()).toMatchObject({ id: chapter2.id, name: 'Chapter2', book: healthBook.id });
      });

      test('Page', async () => {
        expect(await resolver.match('Page').id(page1.id).one()).toMatchObject({ id: page1.id, number: 1, chapter: chapter1.id });
        expect(await resolver.match('Page').id(page2.id).one()).toMatchObject({ id: page2.id, number: 2, chapter: chapter1.id });
        expect(await resolver.match('Page').id(page3.id).one()).toMatchObject({ id: page3.id, number: 1, chapter: chapter2.id });
        expect(await resolver.match('Page').id(page4.id).one()).toMatchObject({ id: page4.id, number: 2, chapter: chapter2.id });
      });

      test('BookStore', async () => {
        expect(await resolver.match('BookStore').id(bookstore1.id).one()).toMatchObject({ id: bookstore1.id, name: 'Best Books Ever', books: [mobyDick.id, mobyDick.id, healthBook.id], building: expect.objectContaining(bookBuilding) });
        expect(await resolver.match('BookStore').id(bookstore2.id).one()).toMatchObject({ id: bookstore2.id, name: 'New Books', books: [mobyDick.id], building: expect.objectContaining(bookBuilding) });
      });

      test('Library', async () => {
        expect(await resolver.match('Library').id(library.id).one()).toMatchObject({ id: library.id, name: 'Public Library', books: [mobyDick.id, healthBook.id, healthBook.id], building: expect.objectContaining(libraryBuilding) });
      });

      test('Null', async () => {
        expect(await resolver.match('Library').id('no-such-id').one()).toBeNull();
      });
    });


    describe('Find', () => {
      test('Person', async () => {
        expect((await resolver.match('Person').many()).length).toBe(2);
        expect(await resolver.match('Person').where({ name: 'nooneatall' }).many()).toMatchObject([]);
        expect(await resolver.match('Person').where({ name: 'richard' }).many()).toMatchObject([{ id: richard.id, name: 'Richard' }]);
        expect(await resolver.match('Person').where({ name: 'Christie' }).many()).toMatchObject([{ id: christie.id, name: 'Christie' }]);
        expect(await resolver.match('Person').where({ emailAddress: 'rich@coderich.com' }).many()).toMatchObject([{ id: richard.id, name: 'Richard' }]);
        expect((await resolver.match('Person').where({ name: ['Richard', 'Christie'] }).many()).sort(sorter)).toMatchObject([{ id: christie.id, name: 'Christie' }, { id: richard.id, name: 'Richard' }].sort(sorter));
        expect((await resolver.match('Person').where({ name: '*' }).many()).sort(sorter)).toMatchObject([{ id: christie.id, name: 'Christie' }, { id: richard.id, name: 'Richard' }].sort(sorter));
        expect(await resolver.match('Person').where({ authored: mobyDick.id }).many()).toMatchObject([{ id: richard.id, name: 'Richard' }]);
        expect(await resolver.match('Person').where({ id: richard.id }).many()).toMatchObject([{ id: richard.id, name: 'Richard' }]);
        expect(await resolver.match('Person').where({ id: richard.id }).one()).toMatchObject({ id: richard.id, name: 'Richard' });
        expect(await resolver.match('Person').where({ id: `${richard.id}` }).many()).toMatchObject([{ id: richard.id, name: 'Richard' }]);
        expect(await resolver.match('Person').where({ id: `${richard.id}` }).one()).toMatchObject({ id: richard.id, name: 'Richard' });
      });

      test('Book', async () => {
        expect((await resolver.match('Book').many()).length).toBe(2);
        expect(await resolver.match('Book').where({ author: 'no-such-id' }).many()).toMatchObject([]);
        expect(await resolver.match('Book').where({ author: richard.id }).many()).toMatchObject([{ id: mobyDick.id, name: 'Moby Dick', author: richard.id }]);
        expect(await resolver.match('Book').where({ price: 9.99 }).many()).toMatchObject([{ id: mobyDick.id, name: 'Moby Dick', author: richard.id }]);
        expect(await resolver.match('Book').where({ price: '9.99' }).many()).toMatchObject([{ id: mobyDick.id, name: 'Moby Dick', author: richard.id }]);
        expect(await resolver.match('Book').where({ author: christie.id }).many()).toMatchObject([{ id: healthBook.id, name: 'Health And Wellness', author: christie.id }]);
        expect(await resolver.match('Book').where({ 'author.id': christie.id }).many()).toMatchObject([{ id: healthBook.id, name: 'Health And Wellness', author: christie.id }]);
        expect(await resolver.match('Book').where({ bestSeller: true }).many()).toMatchObject([{ id: mobyDick.id, name: 'Moby Dick', author: richard.id }]);
        expect(await resolver.match('Book').where({ bestSeller: 'TRu?' }).many()).toMatchObject([{ id: mobyDick.id, name: 'Moby Dick', author: richard.id }]);
        expect(await resolver.match('Book').where({ bestSeller: 'tru' }).many()).toMatchObject([]);
        expect(await resolver.match('Book').where({ price: '?.??' }).many()).toMatchObject([{ id: mobyDick.id, name: 'Moby Dick', author: richard.id }]);
        expect(await resolver.match('Book').where({ price: '??.*' }).many()).toMatchObject([{ id: healthBook.id, name: 'Health And Wellness', author: christie.id }]);
        expect(await resolver.match('Book').where({ bids: [1.99] }).many()).toMatchObject([{ id: mobyDick.id }]);
        expect(await resolver.match('Book').where({ bids: 1.99 }).many()).toMatchObject([{ id: mobyDick.id }]);
        expect((await resolver.match('Book').where({ bids: 5.00 }).many()).sort(sorter)).toMatchObject([{ id: mobyDick.id }, { id: healthBook.id }].sort(sorter));
        expect(await resolver.match('Book').where({ bids: [19.99, '1.99'] }).many()).toMatchObject([{ id: mobyDick.id }]);
        expect(await resolver.match('Book').where({ chapters: chapter1.id }).many()).toMatchObject([{ id: healthBook.id }]);
      });

      test('Chapter', async () => {
        expect((await resolver.match('Chapter').many()).length).toBe(3);
        expect(await resolver.match('Chapter').where({ name: 'cHAPter1' }).many()).toMatchObject([{ id: chapter1.id, name: 'Chapter1', book: healthBook.id }]);
        expect(await resolver.match('Chapter').where({ name: 'cHAPteR2' }).many()).toMatchObject([{ id: chapter2.id, name: 'Chapter2', book: healthBook.id }]);
        expect(await resolver.match('Chapter').where({ name: 'cHAPteR3' }).many()).toEqual([]);
        expect(await resolver.match('Chapter').where({ book: mobyDick.id }).many()).toMatchObject([{ id: chapter3.id, name: 'Newchapter', book: mobyDick.id }]);
        expect(await resolver.match('Chapter').where({ book: 'some-odd-id' }).many()).toEqual([]);
        expect((await resolver.match('Chapter').where({ book: healthBook.id }).many()).sort(sorter)).toMatchObject([
          { id: chapter1.id, name: 'Chapter1', book: healthBook.id },
          { id: chapter2.id, name: 'Chapter2', book: healthBook.id },
        ].sort(sorter));
      });

      test('Page', async () => {
        expect((await resolver.match('Page').many()).length).toBe(6);
        expect((await resolver.match('Page').where({ chapter: chapter1.id }).many()).length).toBe(2);
        expect((await resolver.match('Page').where({ chapter: chapter2.id }).many()).length).toBe(3);
        expect((await resolver.match('Page').where({ number: 1 }).many()).sort(sorter)).toMatchObject([
          { id: page1.id, chapter: chapter1.id },
          { id: page3.id, chapter: chapter2.id },
          { id: page5.id, chapter: chapter3.id },
        ].sort(sorter));
        expect((await resolver.match('Page').where({ number: '2' }).many()).sort(sorter)).toMatchObject([
          { id: page2.id, chapter: chapter1.id },
          { id: page4.id, chapter: chapter2.id },
        ].sort(sorter));
      });

      test('BookStore', async () => {
        expect((await resolver.match('BookStore').many()).length).toBe(2);
        expect((await resolver.match('BookStore').where({ books: [mobyDick.id] }).many()).length).toBe(2);
        expect((await resolver.match('BookStore').where({ name: 'new books' }).many()).sort(sorter)).toMatchObject([
          { id: bookstore2.id, name: 'New Books', building: expect.objectContaining(bookBuilding) },
        ].sort(sorter));
      });

      test('Library', async () => {
        expect((await resolver.match('Library').many()).length).toBe(1);
      });

      // TODO Embedded tests for non-document databases
      if (driver === 'mongo') {
        test('BookStore', async () => {
          expect((await resolver.match('BookStore').where({ building: bookBuilding }).many()).sort(sorter)).toMatchObject([
            { id: bookstore1.id, name: 'Best Books Ever', building: expect.objectContaining(bookBuilding) },
            { id: bookstore2.id, name: 'New Books', building: expect.objectContaining(bookBuilding) },
          ].sort(sorter));
        });

        test('Apartment', async () => {
          expect((await resolver.match('Apartment').where({ 'building.tenants': 'nobody' }).many()).length).toBe(0);
          expect((await resolver.match('Apartment').where({ 'building.year': 1980 }).many()).length).toBe(1);
          expect((await resolver.match('Apartment').where({ 'building.tenants': richard.id }).many()).length).toBe(1);
        });

        test('Art', async () => {
          const arts = await resolver.match('Art').many();
          console.log(JSON.stringify(arts));
          expect(await resolver.match('Art').where({ sections: { id: artsy.sections[0].id } }).one({ debug: true })).toMatchObject(artsy);
          expect(await resolver.match('Art').where({ 'sections.id': artsy.sections[0].id }).one()).toMatchObject(artsy);
        });
      }

      test('Segmentation', async () => {
        expect((await resolver.match('Person').many()).length).toBe(2);
      });
    });


    describe('Count (find)', () => {
      test('Person', async () => {
        expect(await resolver.match('Person').count()).toBe(2);
        expect(await resolver.match('Person').where({ name: 'richard' }).count()).toBe(1);
        expect(await resolver.match('Person').where({ name: 'Christie' }).count()).toBe(1);
      });

      test('Book', async () => {
        expect(await resolver.match('Book').count()).toBe(2);
        expect(await resolver.match('Book').where({ author: richard.id }).count()).toBe(1);
        expect(await resolver.match('Book').where({ price: 9.99 }).count()).toBe(1);
        expect(await resolver.match('Book').where({ price: '9.99' }).count()).toBe(1);
        expect(await resolver.match('Book').where({ author: christie.id }).count()).toBe(1);
      });

      test('Chapter', async () => {
        expect(await resolver.match('Chapter').count()).toBe(3);
        expect(await resolver.match('Chapter').where({ name: 'cHAPter1' }).count()).toBe(1);
        expect(await resolver.match('Chapter').where({ name: 'cHAPteR2' }).count()).toBe(1);
        expect(await resolver.match('Chapter').where({ name: 'cHAPteR3' }).count()).toBe(0);
        expect(await resolver.match('Chapter').where({ book: mobyDick.id }).count()).toBe(1);
        expect(await resolver.match('Chapter').where({ book: 'some-odd-id' }).count()).toEqual(0);
        expect(await resolver.match('Chapter').where({ book: healthBook.id }).count()).toBe(2);
      });

      test('Page', async () => {
        expect(await resolver.match('Page').count()).toBe(6);
        expect(await resolver.match('Page').where({ chapter: chapter1.id }).count()).toBe(2);
        expect(await resolver.match('Page').where({ chapter: chapter2.id }).count()).toBe(3);
        expect(await resolver.match('Page').where({ number: 1 }).count()).toBe(3);
        expect(await resolver.match('Page').where({ number: '2' }).count()).toBe(2);
      });

      test('BookStore', async () => {
        expect(await resolver.match('BookStore').count()).toBe(2);
        expect(await resolver.match('BookStore').where({ books: [mobyDick.id] }).count()).toBe(2);
        expect(await resolver.match('BookStore').where({ name: 'new books' }).count()).toBe(1);
      });

      test('Library', async () => {
        expect(await resolver.match('Library').count()).toBe(1);
      });
    });


    describe('Data Validation', () => {
      test('Person', async () => {
        await expect(resolver.match('Person').save()).rejects.toThrow(); // Should this really throw? New refactor code creates new object and I'm OK with that....
        await expect(resolver.match('Person').save({ name: 'Richard' })).rejects.toThrow();
        await expect(resolver.match('Person').save({ name: 'NewGuy', emailAddress: 'newguy@gmail.com', friends: ['nobody'] })).rejects.toThrow();
        await expect(resolver.match('Person').save({ name: 'NewGuy', emailAddress: 'newguy@gmail.com', friends: [richard.id, 'nobody'] })).rejects.toThrow();
        await expect(resolver.match('Person').save({ name: 'NewGuy', emailAddress: 'newguygmail.com' })).rejects.toThrow();
        await expect(resolver.match('Person').id(richard.id).save({ name: 'Christie' })).rejects.toThrow();
        await expect(resolver.match('Person').id(richard.id).save({ name: 'christie' })).rejects.toThrow();
        await expect(resolver.match('Person').id(richard.id).save({ name: null })).rejects.toThrow();
        await expect(resolver.match('Person').id('nobody').save({ name: 'NewGuy' })).rejects.toThrow();
        await expect(resolver.match('Person').id(richard.id).save({ friends: [richard.id] })).rejects.toThrow();
      });

      test('Book', async () => {
        await expect(resolver.match('Book').save()).rejects.toThrow();
        await expect(resolver.match('Book').save({ name: 'The Bible' })).rejects.toThrow();
        await expect(resolver.match('Book').save({ name: 'The Bible', author: 'Moses' })).rejects.toThrow();
        await expect(resolver.match('Book').save({ name: 'The Bible', author: richard.id })).rejects.toThrow();
        await expect(resolver.match('Book').save({ name: 'The Bible', price: 1.99 })).rejects.toThrow();
        await expect(resolver.match('Book').save({ name: 'No Moby', price: 1.99, author: mobyDick.id })).rejects.toThrow();
        await expect(resolver.match('Book').save({ name: 'The Bible', price: 1.99, author: [christie.id] })).rejects.toThrow();
        await expect(resolver.match('Book').save({ name: 'the bible', price: 1.99, author: christie.id })).rejects.toThrow();
        await expect(resolver.match('Book').save({ name: 'Great Book', price: -1, author: christie.id })).rejects.toThrow();
        await expect(resolver.match('Book').save({ name: 'Best Book', price: 101, author: christie.id })).rejects.toThrow();
        await expect(resolver.match('Book').id(mobyDick.id).save({ author: christie.id })).rejects.toThrow();
        await expect(resolver.match('Book').id(mobyDick.id).save({ author: richard.id })).resolves.toBeDefined();
        await expect(resolver.match('Book', { name: 'MoBY DiCK', price: 1.99, author: richard.id }).save()).rejects.toThrow();
      });

      test('Chapter', async () => {
        await expect(resolver.match('Chapter').save()).rejects.toThrow();
        await expect(resolver.match('Chapter').save({ name: 'chapter1' })).rejects.toThrow();
        await expect(resolver.match('Chapter').save({ name: 'chapter2' })).rejects.toThrow();
        await expect(resolver.match('Chapter').save({ name: 'chapter3' })).rejects.toThrow();

        // Composite key
        switch (driver) {
          case 'mongo': {
            await expect(resolver.match('Chapter').save({ name: 'chapter1', book: healthBook.id })).rejects.toThrow();
            await expect(resolver.match('Chapter').save({ name: 'chapter3', book: christie.id })).rejects.toThrow();
            break;
          }
          default: break;
        }
      });

      test('Page', async () => {
        await expect(resolver.match('Page').save()).rejects.toThrow();
        await expect(resolver.match('Page').save({ number: 3 })).rejects.toThrow();

        // Composite key
        switch (driver) {
          case 'mongo': {
            await expect(resolver.match('Page').save({ number: 1, chapter: chapter1 })).rejects.toThrow();
            await expect(resolver.match('Page').save({ number: 1, chapter: chapter1.id })).rejects.toThrow();
            await expect(resolver.match('Page').save({ number: 1, chapter: page4.id })).rejects.toThrow();
            await expect(resolver.match('Page').id(page1.id).save({ number: 2 })).rejects.toThrow();
            break;
          }
          default: break;
        }
      });

      test('BookStore', async () => {
        await expect(resolver.match('BookStore').save()).rejects.toThrow();
        await expect(resolver.match('BookStore').save({ name: 'New Books' })).rejects.toThrow();
        await expect(resolver.match('BookStore').save({ name: 'New Books', building: 'bad-building' })).rejects.toThrow();
        await expect(resolver.match('BookStore').save({ name: 'besT bookS eveR', building: bookBuilding })).rejects.toThrow();
        await expect(resolver.match('BookStore').save({ name: 'Best Books Ever', building: libraryBuilding })).rejects.toThrow();
        await expect(resolver.match('BookStore').save({ name: 'More More Books', building: bookBuilding, books: richard.id })).rejects.toThrow();
        await expect(resolver.match('BookStore').save({ name: 'More More Books', building: bookBuilding, books: [richard.id] })).rejects.toThrow();
        await expect(resolver.match('BookStore').save({ name: 'More More Books', building: bookBuilding, books: [mobyDick.id, bookBuilding] })).rejects.toThrow();
      });

      test('Library', async () => {
        await expect(resolver.match('Library').save()).rejects.toThrow();
        await expect(resolver.match('Library').save({ name: 'New Library' })).rejects.toThrow();
        await expect(resolver.match('Library').save({ name: 'New Library', building: 'bad-building' })).rejects.toThrow();
        await expect(resolver.match('Library').save({ name: 'New Library', building: libraryBuilding })).rejects.toThrow();
      });

      test('Art', async () => {
        await expect(resolver.match('Art').save({ name: 'sup', comments: ['whoops'] })).rejects.toThrow();
      });
    });


    describe('Data Normalization', () => {
      test('uniq', async () => {
        richard = await resolver.match('Person').id(richard.id).save({ name: 'richard', friends: [christie.id, christie.id, christie.id], telephone: 1234567890 });
        expect(richard.name).toEqual('Richard');
        expect(richard.telephone).toEqual('1234567890');
        expect(richard.friends).toEqual([christie.id]);
      });
    });


    describe('Find (Deep)', () => {
      test('Person', async () => {
        expect(await resolver.match('Person').where({ authored: { name: 'Moby Dick' } }).many()).toMatchObject([{ id: richard.id, name: 'Richard' }]);
        expect(await resolver.match('Person').where({ authored: { author: { name: 'ChRist??' } } }).many()).toMatchObject([{ id: christie.id, name: 'Christie' }]);
        expect(await resolver.match('Person').where({ friends: { name: 'Christie' } }).many()).toMatchObject([{ id: richard.id, name: 'Richard' }]);
        expect(await resolver.match('Person').where({ friends: { authored: { name: 'Health*' } } }).many()).toMatchObject([{ id: richard.id, name: 'Richard' }]);
        expect(await resolver.match('Person').where({ friends: { authored: { name: 'Cray Cray*' } } }).many()).toMatchObject([]);
        expect(await resolver.match('Person').where({ authored: { chapters: { pages: { verbage: 'city lust' } } } }).many()).toMatchObject([]);
        expect(await resolver.match('Person').where({ authored: { chapters: { pages: { verbage: 'the end.' } } } }).many()).toMatchObject([{ id: christie.id, name: 'Christie' }]);
        expect(await resolver.match('Person').where({ authored: { chapters: { pages: { verbage: '*intro*' } } } }).many()).toMatchObject([{ id: christie.id, name: 'Christie' }]);
        expect(await resolver.match('Person').where({ authored: { chapters: { name: 'citizen', pages: { verbage: '*intro*' } } } }).many()).toMatchObject([]);
        expect(await resolver.match('Person').where({ authored: { chapters: { name: 'chapter*', pages: { verbage: '*intro*' } } } }).many()).toMatchObject([{ id: christie.id, name: 'Christie' }]);
        expect(await resolver.match('Person').where({ authored: { chapters: { name: '{citizen,chap*}', pages: { verbage: '*intro*' } } } }).many()).toMatchObject([{ id: christie.id, name: 'Christie' }]);

        // Covenience counterparts
        expect(await resolver.match('Person').where({ 'authored.name': 'Moby Dick' }).many()).toMatchObject([{ id: richard.id, name: 'Richard' }]);
        expect(await resolver.match('Person').where({ 'authored.author.name': 'ChRist??' }).many()).toMatchObject([{ id: christie.id, name: 'Christie' }]);
        expect(await resolver.match('Person').where({ 'friends.name': 'Christie' }).many()).toMatchObject([{ id: richard.id, name: 'Richard' }]);
        expect(await resolver.match('Person').where({ 'friends.authored.name': 'Health*' }).many()).toMatchObject([{ id: richard.id, name: 'Richard' }]);
        expect(await resolver.match('Person').where({ 'friends.authored.name': 'Cray Cray*' }).many()).toMatchObject([]);
        expect(await resolver.match('Person').where({ 'authored.chapters.pages.verbage': 'city lust' }).many()).toMatchObject([]);
        expect(await resolver.match('Person').where({ 'authored.chapters.pages.verbage': 'the end.' }).many()).toMatchObject([{ id: christie.id, name: 'Christie' }]);
        expect(await resolver.match('Person').where({ 'authored.chapters.pages.verbage': '*intro*' }).many()).toMatchObject([{ id: christie.id, name: 'Christie' }]);
        expect(await resolver.match('Person').where({ 'authored.chapters.name': 'citizen', 'authored.chapters.pages.verbage': '*intro*' }).many()).toMatchObject([]);
        expect(await resolver.match('Person').where({ 'authored.chapters.name': 'chapter*', 'authored.chapters.pages.verbage': '*intro*' }).many()).toMatchObject([{ id: christie.id, name: 'Christie' }]);
        expect(await resolver.match('Person').where({ 'authored.chapters.name': '{citizen,chap*}', 'authored.chapters.pages.verbage': '*intro*' }).many()).toMatchObject([{ id: christie.id, name: 'Christie' }]);
        expect(await resolver.match('Person').where({ 'authored.chapters': { name: 'citizen', 'pages.verbage': '*intro*' } }).many()).toMatchObject([]);
        expect(await resolver.match('Person').where({ 'authored.chapters': { name: 'chapter*', 'pages.verbage': '*intro*' } }).many()).toMatchObject([{ id: christie.id, name: 'Christie' }]);
        expect(await resolver.match('Person').where({ 'authored.chapters': { name: '{citizen,chap*}', 'pages.verbage': '*intro*' } }).many()).toMatchObject([{ id: christie.id, name: 'Christie' }]);
      });

      test('Book', async () => {
        expect(await resolver.match('Book').where({ author: { name: 'nooneatall' } }).many()).toMatchObject([]);
        expect(await resolver.match('Book').where({ author: { name: 'Richard' } }).many()).toMatchObject([{ id: mobyDick.id }]);
        expect(await resolver.match('Book').where({ author: { authored: { name: 'Moby*' } } }).many()).toMatchObject([{ id: mobyDick.id }]);
        expect(await resolver.match('Book').where({ author: { authored: { name: 'Health*' } } }).many()).toMatchObject([{ id: healthBook.id }]);
        expect((await resolver.match('Book').where({ author: { authored: { name: '*' } } }).many()).sort(sorter)).toMatchObject([{ id: healthBook.id }, { id: mobyDick.id }].sort(sorter));
        expect(await resolver.match('Book').where({ chapters: { name: 'Chapter1' } }).many()).toMatchObject([{ id: healthBook.id }]);
        expect(await resolver.match('Book').where({ chapters: { name: ['chapter1', 'chapter2'] } }).many()).toMatchObject([{ id: healthBook.id }]);
        expect(await resolver.match('Book').where({ chapters: { name: ['chapter1', 'no-chapter'] } }).many()).toMatchObject([{ id: healthBook.id }]);
        expect((await resolver.match('Book').where({ chapters: { name: '*' } }).many()).sort(sorter)).toMatchObject([{ id: mobyDick.id }, { id: healthBook.id }].sort(sorter));
        expect((await resolver.match('Book').where({ chapters: { pages: { number: 1 } } }).many()).sort(sorter)).toMatchObject([{ id: mobyDick.id }, { id: healthBook.id }].sort(sorter));
        expect(await resolver.match('Book').where({ chapters: { pages: { number: 2 } } }).many()).toMatchObject([{ id: healthBook.id }]);
        expect(await resolver.match('Book').where({ chapters: [{ name: 'HongKong' }, chapter1.id] }).many()).toMatchObject([{ id: healthBook.id }]);
      });
    });


    describe('Update', () => {
      test('Person', async () => {
        expect(await resolver.match('Person').id(richard.id).save({ name: 'Rich' })).toMatchObject({ id: richard.id, name: 'Rich' });
        expect(await resolver.match('Person').id(richard.id).save({ name: 'richard' })).toMatchObject({ id: richard.id, name: 'Richard' });
        expect(await resolver.match('Person').id(richard.id).save({ status: 'active' })).toMatchObject({ id: richard.id, name: 'Richard', status: 'active' });
        expect(await resolver.match('Person').id(richard.id).save({ status: null })).toMatchObject({ id: richard.id, name: 'Richard', status: null });
      });

      test('Book', async () => {
        expect(await resolver.match('Book').id(mobyDick.id).save({ name: 'mopey dick' })).toMatchObject({ id: mobyDick.id, name: 'Mopey Dick' });
        expect(await resolver.match('Book').id(mobyDick.id).save({ name: 'moby dick' })).toMatchObject({ id: mobyDick.id, name: 'Moby Dick' });
        expect(await resolver.match('Book').id(mobyDick.id).save({ bids: [] })).toMatchObject({ id: mobyDick.id, name: 'Moby Dick', bids: [] });
        expect(await resolver.match('Book').id(mobyDick.id).save({ bids: null })).toMatchObject({ id: mobyDick.id, name: 'Moby Dick', bids: null });
      });

      test('Apartment', async () => {
        expect(await resolver.match('Apartment').id(apartment.id).save({ 'building.year': 1978 })).toMatchObject({ building: { year: 1978 } });
        expect(await resolver.match('Apartment').id(apartment.id).one()).toMatchObject({ name: apartment.name, building: { year: 1978, tenants: [richard.id, christie.id] } });
      });

      test('Push/Pull', async () => {
        expect(await resolver.match('Book').id(mobyDick.id).push('bids', 2.99, 1.99, 5.55)).toMatchObject({ id: mobyDick.id, name: 'Moby Dick', bids: [2.99, 1.99, 5.55] });
        expect(await resolver.match('Book').id(mobyDick.id).pull('bids', 1.99)).toMatchObject({ id: mobyDick.id, name: 'Moby Dick', bids: [2.99, 5.55] });
        expect(await resolver.match('Book').id(healthBook.id).push('bids', 0.25, 0.25, 11.00, 0.25)).toMatchObject({ id: healthBook.id, name: 'Health And Wellness', bids: [5.00, 9.00, 12.50, 0.25, 0.25, 11.00, 0.25] });
        expect(await resolver.match('Book').id(healthBook.id).pull('bids', 0.25, 9.00)).toMatchObject({ id: healthBook.id, name: 'Health And Wellness', bids: [5.00, 12.50, 11.00] });
      });
    });


    describe('Remove', () => {
      test('Art', async () => {
        const art = await resolver.match('Art').save({ name: 'bye bye', comments: ['yay'] });
        expect(art).toBeDefined();
        expect(await resolver.match('Art').id(art.id).one()).not.toBeNull();
        expect(await resolver.match('Art').id(art.id).remove()).toMatchObject({ id: art.id, name: 'Bye Bye' });
        expect(await resolver.match('Art').id(art.id).one()).toBeNull();
        await resolver.match('Art').id(artsy.id).remove(); // Need to delete it to not mess up later tests
      });
    });


    describe('Query (sortBy sliced results)', () => {
      test('sortBy', async () => {
        expect(await resolver.match('Book').sortBy({ name: 'asc' }).one()).toMatchObject({ id: healthBook.id, name: 'Health And Wellness' });
        expect(await resolver.match('Book').sortBy({ name: 'desc' }).one()).toMatchObject({ id: mobyDick.id, name: 'Moby Dick' });
        expect(await resolver.match('Book').sortBy({ name: 'desc' }).first(1)).toMatchObject([{ id: mobyDick.id, name: 'Moby Dick' }]);
        expect(await resolver.match('Book').sortBy({ name: 'desc' }).last(1)).toMatchObject([{ id: healthBook.id, name: 'Health And Wellness' }]);
        expect(await resolver.match('Book').sortBy({ name: 'asc' }).first(1)).toMatchObject([{ id: healthBook.id, name: 'Health And Wellness' }]);
        expect(await resolver.match('Book').sortBy({ name: 'asc' }).last(1)).toMatchObject([{ id: mobyDick.id, name: 'Moby Dick' }]);
        expect(await resolver.match('Book').sortBy({ name: 'asc' }).first(2)).toMatchObject([{ id: healthBook.id, name: 'Health And Wellness' }, { id: mobyDick.id, name: 'Moby Dick' }]);
        expect(await resolver.match('Book').sortBy({ name: 'asc' }).last(2)).toMatchObject([{ id: healthBook.id, name: 'Health And Wellness' }, { id: mobyDick.id, name: 'Moby Dick' }]);
      });
    });


    describe('Query (sortBy with Cursors)', () => {
      test('sortBy', async () => {
        const [health, moby] = await resolver.match('Book').sortBy({ name: 'asc' }).many();
        const [healthCursor, mobyCursor] = [health.$$cursor, moby.$$cursor];
        expect(healthCursor).toBeDefined();
        expect(mobyCursor).toBeDefined();
        expect(await resolver.match('Book').sortBy({ name: 'asc' }).after(healthCursor).first(1)).toMatchObject([{ id: mobyDick.id, name: 'Moby Dick' }]);
        expect(await resolver.match('Book').sortBy({ name: 'asc' }).after(healthCursor).last(1)).toMatchObject([{ id: mobyDick.id, name: 'Moby Dick' }]);
        expect(await resolver.match('Book').sortBy({ name: 'asc' }).before(healthCursor).first(1)).toMatchObject([]);
        expect(await resolver.match('Book').sortBy({ name: 'asc' }).before(healthCursor).last(1)).toMatchObject([]);
        expect(await resolver.match('Book').sortBy({ name: 'asc' }).after(mobyCursor).first(1)).toMatchObject([]);
        expect(await resolver.match('Book').sortBy({ name: 'asc' }).after(mobyCursor).last(1)).toMatchObject([]);
        expect(await resolver.match('Book').sortBy({ name: 'asc' }).before(mobyCursor).first(1)).toMatchObject([{ id: healthBook.id, name: 'Health And Wellness' }]);
        expect(await resolver.match('Book').sortBy({ name: 'asc' }).before(mobyCursor).last(1)).toMatchObject([{ id: healthBook.id, name: 'Health And Wellness' }]);
      });
    });


    // describe('Query (sortBy deep)', () => {
    //   test('sortBy', async () => {
    //     expect(await resolver.match('Person').sortBy({ authored: { chapters: { name: 'asc' } } }).many()).toMatchObject([{ id: christie.id }, { id: richard.id }]);
    //     expect(await resolver.match('Person').sortBy({ authored: { chapters: { name: 'desc' } } }).many()).toMatchObject([{ id: richard.id }, { id: christie.id }]);
    //     // expect(await resolver.match('Person').sortBy({ authored: { chapters: { countPages: 'asc' } } }).many()).toMatchObject([{ id: richard.id }, { id: christie.id }]);
    //     // expect(await resolver.match('Person').sortBy({ authored: { chapters: { countPages: 'desc' } } }).many()).toMatchObject([{ id: christie.id }, { id: richard.id }]);
    //     // expect(await resolver.match('Chapter').sortBy({ countPages: 'asc', name: 'desc' }).many()).toMatchObject([{ name: 'Chapter1' }, { name: 'Chapter2' }]);
    //     // expect(await resolver.match('Chapter').sortBy({ countPages: 'desc', name: 'desc' }).many()).toMatchObject([{ name: 'Chapter2' }, { name: 'Chapter1' }]);

    //     // Convenience counterparts
    //     expect(await resolver.match('Person').sortBy({ 'authored.chapters.name': 'asc' }).many()).toMatchObject([{ id: christie.id }, { id: richard.id }]);
    //     expect(await resolver.match('Person').sortBy({ 'authored.chapters.name': 'desc' }).many()).toMatchObject([{ id: richard.id }, { id: christie.id }]);
    //     // expect(await resolver.match('Person').sortBy({ 'authored.chapters.countPages': 'asc' }).many()).toMatchObject([{ id: richard.id }, { id: christie.id }]);
    //     // expect(await resolver.match('Person').sortBy({ 'authored.chapters.countPages': 'desc' }).many()).toMatchObject([{ id: christie.id }, { id: richard.id }]);
    //   });
    // });


    // describe('Query (find & sortBy deep)', () => {
    //   test('whereSortBy', async () => {
    //     expect(await resolver.match('Person').where({ 'authored.name': '*' }).sortBy({ authored: { chapters: { name: 'asc' } } }).many()).toMatchObject([{ id: christie.id }, { id: richard.id }]);
    //     expect(await resolver.match('Person').where({ 'authored.name': '*' }).sortBy({ authored: { chapters: { name: 'desc' } } }).many()).toMatchObject([{ id: richard.id }, { id: christie.id }]);
    //     expect(await resolver.match('Person').where({ 'authored.chapters.pages.verbage': 'the end.' }).sortBy({ authored: { chapters: { name: 'asc' } } }).many()).toMatchObject([{ id: christie.id }]);
    //     expect(await resolver.match('Person').where({ 'authored.chapters.pages.verbage': 'the end.' }).sortBy({ authored: { chapters: { name: 'desc' } } }).many()).toMatchObject([{ id: christie.id }]);
    //   });
    // });


    describe('Transactions (auto)', () => {
      test('multi-update', async () => {
        expect(await resolver.match('Person').where({}).save({ status: 'online' })).toMatchObject([{ status: 'online' }, { status: 'online' }]);
        expect(await resolver.match('Person').many()).toMatchObject([{ status: 'online' }, { status: 'online' }]);
        await resolver.match('Person').where({ status: 'online' }).save({ status: 'offline' });
        expect(await resolver.match('Person').many()).toMatchObject([{ status: 'offline' }, { status: 'offline' }]);
        await expect(resolver.match('Chapter').save({ name: 'chapter1' }, { name: 'chapter2' })).rejects.toThrow();
      });

      test('multi-push-pull', async () => {
        // push
        await resolver.match('Art').save({ name: 'Art1' }, { name: 'Art2' });
        await resolver.match('Art').where({}).push('bids', 69.99, '109.99');
        expect(await resolver.match('Art').many()).toMatchObject([{ bids: [69.99, 109.99] }, { bids: [69.99, 109.99] }]);
        // pull
        await resolver.match('Art').where({}).pull('bids', '69.99');
        expect(await resolver.match('Art').many()).toMatchObject([{ bids: [109.99] }, { bids: [109.99] }]);
      });
    });


    if (options.transactions !== false) {
      describe('Transactions (manual)', () => {
        test('single txn (commit)', async () => {
          const txn1 = resolver.transaction();
          txn1.match('Person').save({ name: 'person1', emailAddress: 'person1@gmail.com' });
          txn1.match('Person').save({ name: 'person2', emailAddress: 'person2@gmail.com' });
          const [person1$1, person2$1] = await txn1.exec();
          expect(person1$1.id).toBeDefined();
          expect(person1$1.name).toBe('Person1');
          expect(person2$1.id).toBeDefined();
          expect(person2$1.name).toBe('Person2');
          expect(await resolver.match('Person').id(person1$1.id).one()).toBeNull();
          await txn1.commit();
          expect(await resolver.match('Person').id(person1$1.id).one()).not.toBeNull();
        });

        test('single txn (rollback)', async () => {
          const txn1 = resolver.transaction();
          txn1.match('Person').save({ name: 'person3', emailAddress: 'person3@gmail.com' });
          txn1.match('Person').save({ name: 'person4', emailAddress: 'person4@gmail.com' });
          const [person1$1, person2$1] = await txn1.exec();
          expect(person1$1.name).toBe('Person3');
          expect(person2$1.name).toBe('Person4');
          expect(await resolver.match('Person').id(person1$1.id).one()).toBeNull();
          await txn1.rollback();
          expect(await resolver.match('Person').id(person1$1.id).one()).toBeNull();
        });

        test('single txn (duplicate key)', async () => {
          const txn1 = resolver.transaction();
          txn1.match('Person').save({ name: 'person1', emailAddress: 'person1@gmail.com' });
          txn1.match('Person').save({ name: 'person2', emailAddress: 'person2@gmail.com' });
          await expect(txn1.exec()).rejects.toThrow();
        });

        test('single-txn (read & write)', async (done) => {
          const txn = resolver.transaction();
          txn.match('Person').save({ name: 'write1', emailAddress: 'write1@gmail.com' });
          txn.match('Person').id(richard.id).one();
          txn.match('Person').save({ name: 'write2', emailAddress: 'write2@gmail.com' });
          const [person1, richie, person2] = await txn.exec();
          expect(person1.name).toBe('Write1');
          expect(richie.name).toBe('Richard');
          expect(person2.name).toBe('Write2');
          txn.rollback().then(() => done());
        });
      });

      describe('Transactions (manual-with-auto)', () => {
        test('multi-txn (duplicate key with rollback)', async (done) => {
          const txn1 = resolver.transaction();
          const txn2 = resolver.transaction();
          txn1.match('Person').save({ name: 'person10', emailAddress: 'person10@gmail.com' }, { name: 'person11', emailAddress: 'person11@gmail.com' });
          txn2.match('Person').save({ name: 'person10', emailAddress: 'person10@gmail.com' }, { name: 'person11', emailAddress: 'person11@gmail.com' });

          txn1.exec().then((results) => {
            const [[person1, person2]] = results;
            expect(person1.name).toBe('Person10');
            expect(person2.name).toBe('Person11');
            txn1.rollback();
          });

          await timeout(100);

          txn2.exec().then(async (results) => {
            const [[person1, person2]] = results;
            expect(person1.name).toBe('Person10');
            expect(person2.name).toBe('Person11');
            txn2.rollback().then(() => done());
          });
        });

        test('multi-txn (duplicate key with commit)', async () => {
          const txn1 = resolver.transaction();
          const txn2 = resolver.transaction();
          txn1.match('Person').save({ name: 'person10', emailAddress: 'person10@gmail.com' }, { name: 'person11', emailAddress: 'person11@gmail.com' });
          txn2.match('Person').save({ name: 'person10', emailAddress: 'person10@gmail.com' }, { name: 'person11', emailAddress: 'person11@gmail.com' });

          txn1.exec().then((results) => {
            const [[person1, person2]] = results;
            expect(person1.name).toBe('Person10');
            expect(person2.name).toBe('Person11');
            txn1.commit();
          });

          await timeout(100);
          await expect(txn2.exec()).rejects.toThrow();
        });
      });
    }


    describe('Referential Integrity', () => {
      test('remove', async () => {
        // await expect(resolver.match('Person').remove()).rejects.toThrow();
        await expect(resolver.match('Person').id(christie.id).remove()).rejects.toThrow();
        // await resolver.match('Chapter').id(chapter3.id).remove(); // Need to delete chapter to remove Author....
        // expect(await resolver.match('Person').id(richard.id).remove()).toMatchObject({ id: richard.id, name: 'Richard' });
        // expect(await resolver.match('Person').where({ name: '{christie,richard}' }).many()).toMatchObject([{ id: christie.id }]);
        // expect(await resolver.match('Book').many()).toMatchObject([{ id: healthBook.id }]);
        // expect(await resolver.match('Chapter').sortBy({ name: 'ASC' }).many()).toMatchObject([{ id: chapter1.id }, { id: chapter2.id }]);
      });

      // test('remove multi', async () => {
      //   // Create some colors
      //   const colors = await resolver.match('Color').save({ type: 'blue' }, { type: 'red' }, { type: 'green' }, { type: 'purple' });
      //   expect(colors.length).toBe(4);

      //   // Remove some colors
      //   const ids = await resolver.match('Color').where({ type: '{red,purple}' }).remove();
      //   const results = await resolver.match('Color').sortBy({ type: 'ASC' }).many();
      //   expect(ids.sort(sorter)).toMatchObject([{ id: colors[1].id }, { id: colors[3].id }].sort(sorter));
      //   expect(results).toMatchObject([{ type: 'blue' }, { type: 'green' }]);
      // });
    });


    // describe('$hydrated results', () => {
    //   test('manual', async () => {
    //     const person = await resolver.match('Person').id(christie.id).one();
    //     expect(person.$authored.name).not.toBeDefined();

    //     // Hydrate book
    //     const [$book] = await person.$authored;
    //     expect($book.name).toBe('Health And Wellness');

    //     // Sanity check that you're able to await repeatedly
    //     const [$book2] = await person.$authored;
    //     expect($book2.name).toBe('Health And Wellness');
    //   });
    // });


    // describe('Native Queries', () => {
    //   test('get', async () => {
    //     switch (driver) {
    //       case 'mongo': {
    //         expect(await resolver.match('Person').native({ name: 'Richard' }).one()).toBeNull();
    //         expect(await resolver.match('Person').native({ name: 'christie' }).one()).toBeNull(); // case sensitive
    //         expect(await resolver.match('Person').native({ name: 'Christie' }).one()).toMatchObject({ id: christie.id, name: 'Christie', emailAddress: 'christie@gmail.com' });
    //         expect(await resolver.match('Person').native({ name: 'Richard' }).count()).toBe(0);
    //         expect(await resolver.match('Person').native({ name: 'christie' }).count()).toBe(0);
    //         expect(await resolver.match('Person').native({ name: 'Christie' }).count()).toBe(1);
    //         const count = await resolver.match('Person').native({ name: { $ne: 'chard' } }).count();
    //         expect(count).toBeGreaterThanOrEqual(1);
    //         expect(await resolver.match('Person').native({ name: { $ne: 'Christie' } }).count()).toBe(count - 1);
    //         expect(await resolver.match('Person').native({ email_address: 'christie@gmail.com' }).count()).toBe(1);
    //         break;
    //       }
    //       default: {
    //         break;
    //       }
    //     }
    //   });
    // });


    // describe('Raw Queries', () => {
    //   test('get', async () => {
    //     switch (driver) {
    //       case 'mongo': {
    //         expect(await resolver.raw('Person').findOne({})).toBeDefined();
    //         expect(await resolver.raw('Person').findOne({ name: 'Richard' })).toBeNull();
    //         expect(await resolver.raw('Person').findOne({ name: 'christie' })).toBeNull();
    //         expect(await resolver.raw('Person').findOne({ name: 'Christie' })).toMatchObject({ name: 'Christie', email_address: 'christie@gmail.com' });
    //         break;
    //       }
    //       default: {
    //         break;
    //       }
    //     }
    //   });
    // });


    // describe('Bug Fixes', () => {
    //   test('embedded arrays', async () => {
    //     const art = await resolver.match('Art').save({ name: 'Piedmont Beauty', sections: [{ name: 'Section1' }] });
    //     expect(art.id).toBeDefined();
    //     expect(art.sections).toMatchObject([{ name: 'section1' }]); // toLowerCase
    //     expect(art.sections[0].id).toBeDefined();
    //     expect(art.sections[0].name).toBeDefined();
    //     expect(art.sections[0].$name).toBeDefined();
    //   });

    //   test('push/pull embedded arrays', async () => {
    //     const art = await resolver.match('Art').save({ name: 'Piedmont Beauty' });

    //     // Push
    //     const push = await resolver.match('Art').id(art.id).push('sections', { name: 'Pushed Section' });
    //     expect(push.sections.length).toBe(1);
    //     expect(push.sections[0].id).toBeDefined();
    //     expect(push.sections[0].name).toEqual('pushed section');
    //     expect(push.sections[0].$name).toBeDefined();

    //     // Pull
    //     const pull = await resolver.match('Art').id(art.id).pull('sections', { name: 'pushed section' });
    //     expect(pull.sections.length).toBe(0);
    //   });

    //   test('embedded array with modelRef', async () => {
    //     // Create section
    //     await expect(resolver.match('Art').save({ name: 'Piedmont Beauty', sections: [{ name: 'Section1', person: richard.id }] })).rejects.toThrow();
    //     const art = await resolver.match('Art').save({ name: 'Piedmont Beauty', sections: [{ name: 'Section1', person: christie.id }] });
    //     expect(art).toBeDefined();
    //     expect(art.sections[0].id).toBeDefined();
    //     expect(art.sections[0].person).toBe(christie.id);
    //     expect((await art.sections[0].$person).name).toBe('Christie');
    //   });

    //   test('update should not clobber unknown attributes', async () => {
    //     switch (driver) {
    //       case 'mongo': {
    //         await resolver.raw('Person').findOneAndUpdate({ _id: christie.id }, { $set: { unknownAttr: 1 } });
    //         const person = await resolver.match('Person').id(christie.id).save({ age: 20 });
    //         expect(person.age).toBe(20);
    //         const dbPerson = await resolver.raw('Person').findOne({ _id: christie.id });
    //         expect(dbPerson).toBeDefined();
    //         expect(dbPerson.unknownAttr).toBe(1);
    //         break;
    //       }
    //       default: break;
    //     }
    //   });

    //   test('where clause with one(required) should throw', async () => {
    //     await expect(resolver.match('Person').where({ age: 400 }).one({ required: true })).rejects.toThrow();
    //     await expect(resolver.match('Person').where({ age: 400 }).many({ required: true })).rejects.toThrow();
    //   });
    // });
  });
};
