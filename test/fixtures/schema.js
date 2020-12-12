const Rule = require('../../src/core/Rule');

Rule.extend('bookName', Rule.deny('The Bible'));
Rule.extend('bookPrice', Rule.range(0, 100));
Rule.extend('artComment', Rule.allow('yay', 'great', 'boo'));
Rule.extend('colors', Rule.allow('blue', 'red', 'green', 'purple'));
Rule.extend('buildingType', Rule.allow('home', 'office', 'business'));

module.exports = {
  typeDefs: `
    input PersonInputMeta {
      notify: Boolean
    }

    type Person
      @model(meta: "PersonInputMeta")
      @index(name: "uix_person_name", type: unique, on: [name])
    {
      name: String! @field(transform: toTitleCase)
      authored: [Book] @link(by: author)
      emailAddress: String! @field(key: "email_address", enforce: email)
      friends: [Person] @field(transform: dedupe, enforce: selfless, onDelete: cascade)
      status: String @field(key: "state")
      # state: String @field(key: "address_state")
      telephone: String @field(default: "###-###-####")
      network: String @value(scope: context, path: "network.id")
    }

    type Book
      @model
      @index(name: "uix_book", type: unique, on: [name, author])
    {
      name: String! @field(transform: toTitleCase, enforce: bookName)
      price: Float! @field(enforce: bookPrice)
      author: Person! @field(enforce: immutable, onDelete: cascade)
      bestSeller: Boolean
      bids: [Float]
      chapters: [Chapter] @link(by: book)
    }

    type Chapter
      @model
      @index(name: "uix_chapter", type: unique, on: [name, book])
    {
      name: String! @field(key: "chapter_name" transform: toTitleCase)
      book: Book! @field(onDelete: restrict)
      pages: [Page] @link(by: chapter)
    }

    type Page
      @model
      @index(name: "uix_page", type: unique, on: [number, chapter])
    {
      number: Int!
      verbage: String
      chapter: Chapter!
    }

    type BookStore
      @model
      @index(name: "uix_bookstore", type: unique, on: [name])
    {
      name: String! @field(transform: toTitleCase)
      location: String
      books: [Book] @field(onDelete: cascade)
      building: Building!
    }

    type Library
      @model
      @index(name: "uix_library", type: unique, on: [name])
      @index(name: "uix_library_bulding", type: unique, on: [building])
    {
      name: String! @field(transform: toTitleCase)
      location: String,
      books: [Book] @field(onDelete: cascade)
      building: Building!
    }

    type Apartment
      @model
      @index(name: "uix_apartment", type: unique, on: [name])
      @index(name: "uix_apartment_bulding", type: unique, on: [building])
    {
      name: String! @field(transform: toTitleCase)
      location: String
      building: Building!
    }

    type Building
    {
      year: Int @field(key: "year_built")
      type: String! @field(enforce: buildingType)
      tenants: [Person] @field(enforce: distinct, onDelete: cascade)
      landlord: Person @field(onDelete: nullify)
      description: String @field(default: "A building from the bloom")
    }

    type Color
      @model
    {
      type: String! @field(enforce: colors)
      isDefault: Boolean @field(noRepeat: true)
    }

    type Art
      @model
    {
      name: String! @field(transform: toTitleCase)
      bids: [Float]
      comments: [String] @field(enforce: artComment)
      sections: [Section]
    }

    type Section @model(embed: true) {
      name: String! @field(transform: toLowerCase)
      description: String
      person: Person
    }

    type PlainJane {
      id: ID!
      name: String
    }
  `,
};
