---
title: "Idiomatic Interfaces in Go"
date: 2019-07-06T17:33:32+05:30
draft: true
---

In my last refactoring excercise I had suggested that we use interfaces to ensure that our code has enough abstraction to allow mocking and stubbing while writing unit test cases.

As all the four teams took up this excercise, most of us (if not all) created structures similar to the following.

```
type IProductRepo interface {
	GetProducts() ([]Product, error)
	SaveProduct(Product) (bool, error)
}

type ProductRepo struct {
	Db *sqlx.DB
}

func NewProductRepo(db *sqlx.DB) IProductRepo {
	return &ProductPGRepo{Db: db}
}

func (pr ProductRepo) GetProducts() ([]Products, error) {
	// fetch products
}

func (pr ProductRepo) SaveProduct(p Product) (bool, error) {
	// save products
}
```

Although the above code is not technically incorrect, the naming conventions are borrowed from C#.

On close examination you will realize that there is no need to export ProductRepo. We can rename the inteface to ProductRepo and unexport the structure. This should take us a step closer to writing idiomatic Go.

```
type ProductRepo interface {
	GetProducts() ([]Product, error)
	SaveProduct(Product) (bool, error)
}

type productrepo struct {
	Db *sqlx.DB
}

func NewProductRepo(db *sqlx.DB) ProductRepo {
	return &productrepo{Db: db}
}

func (pr productrepo) GetProducts() ([]Products, error) {
	// fetch products
}

func (pr productrepo) SaveProduct(p Product) (bool, error) {
	// save products
}
```

"The larger the interface, the weaker the abstraction" – Rob Pike

The final destination in the Idomatic Go Land would be to make the the interfaces as granular as possible.

```
type ProductReaderRepo interface {
	ReadProducts() ([]Products, error)
}

type ProductWriterRepo interface {
	WriteProduct(Product) (bool, error)
}

type ProductReaderWriterRepo interface {
	ProductReaderRepo
	ProductWriterRepo
}

type productrepo struct {
	Db *sqlx.DB
}

func NewProductRepo(db *sqlx.DB) ProductReaderWriterRepo {
	return &productrepo{Db: db}
}

func (pr productrepo) ReadProducts() ([]Product, error) {
	// fetch products
}

func (pr productrepo) WriteProduct(p Product) (bool, error) {
	// save products
}
```

I learnt these patterns a few weeks too late, but given that our projects are still small you can incorporate these ideas in your respective projects.